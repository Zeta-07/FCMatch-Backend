import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { verify } from 'argon2';
import { runner } from 'node-pg-migrate';
import type pg from 'pg';
import { createPool } from '../../src/shared/db/pool.js';
import { loadConfig } from '../../src/shared/config/env.js';
import { loadIdentityConfig } from '../../src/shared/config/identity.js';
import { createMailTransport } from '../../src/shared/mail/transport.js';
import { createApp } from '../../src/app.js';
import {
  RegistrationService,
  abuseDigest,
  tokenDigest,
} from '../../src/modules/users/service/registration.js';
import { IdentityRepository } from '../../src/modules/users/repository/identity.js';
import { createPasswordHasher } from '../../src/modules/users/service/password.js';
import { createVerificationDelivery } from '../../src/modules/users/service/verification-mail.js';

let pool: pg.Pool;
const base = loadConfig();
before(async () => {
  assert.ok(base.TEST_DATABASE_URL);
  assert.ok(new URL(base.TEST_DATABASE_URL).pathname.endsWith('_test'));
  assert.notEqual(
    new URL(base.TEST_DATABASE_URL).pathname,
    new URL(base.DATABASE_URL).pathname,
  );
  await runner({
    databaseUrl: base.TEST_DATABASE_URL,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'schema_migrations',
    advisoryLockMode: 'wait',
    checkOrder: true,
    singleTransaction: true,
    log: () => {},
  });
  pool = createPool(base.TEST_DATABASE_URL);
});
after(async () => {
  if (pool) await pool.end();
});

async function fixture(
  mode: 'accept' | 'reject' | 'ambiguous' | 'offline' = 'accept',
) {
  const received: string[] = [];
  const logs: string[] = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        received.push(Buffer.concat(chunks).toString('utf8'));
        if (mode === 'reject')
          callback(
            Object.assign(new Error('Rechazo sintético'), {
              responseCode: 550,
            }),
          );
        else if (mode === 'accept') callback();
        // Ambiguo: recibe DATA pero no responde; Nodemailer vence sin descartar el token.
      });
    },
  });
  smtp.on('error', () => {});
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const port = (smtp.server.address() as { port: number }).port;
  const mail = createMailTransport({
    ...base,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: port,
    SMTP_SECURE: false,
    SMTP_USER: '',
    SMTP_PASSWORD: '',
  });
  if (mode === 'offline')
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  const config = loadIdentityConfig(
    {
      ...base,
      CORS_ORIGINS: ['http://localhost:4200', 'http://localhost:8100'],
    },
    {
      IDENTITY_CSRF_SECRET: randomBytes(32).toString('hex'),
      IDENTITY_ABUSE_SECRET: randomBytes(32).toString('hex'),
      IDENTITY_WEB_ORIGIN: 'http://localhost:4200',
      IDENTITY_MOBILE_ORIGIN: 'http://localhost:8100',
      IDENTITY_API_ORIGIN: 'http://localhost:3000',
    },
  );
  const service = new RegistrationService(
    new IdentityRepository(pool),
    createPasswordHasher(),
    createVerificationDelivery(
      (message) => mail.sendMail(message),
      base.SMTP_FROM,
      config.webOrigin,
      (...parts) => logs.push(parts.join(' ')),
    ),
    config.abuseSecret,
  );
  const app = createApp(
    { ...base, CORS_ORIGINS: [config.webOrigin, config.mobileOrigin] },
    pool,
    { service, config },
  );
  const csrf = await request(app)
    .get('/api/v1/auth/csrf')
    .set('Origin', config.webOrigin)
    .expect(200);
  const cookie = (csrf.headers['set-cookie'] as unknown as string[])
    .at(-1)!
    .split(';')[0]!;
  const emails: string[] = [];
  const data = () => {
    const seed = randomUUID().replaceAll('-', '');
    const email = `${seed}@fcmatch.test`;
    emails.push(email);
    return {
      email,
      username: `t_${seed.slice(0, 24)}`,
      password: '  Frase sintética de integración 🏆  ',
    };
  };
  const post = (path: string, body: object) =>
    request(app)
      .post(`/api/v1/auth/${path}`)
      .set('Origin', config.webOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send(body);
  const token = (index = 0) => {
    const decoded = received[index]!.replace(/=\r?\n/g, '').replace(
      /=3D/g,
      '=',
    );
    const result = decoded.match(/#token=([A-Za-z0-9_-]{43})/);
    assert.ok(
      result,
      'SMTP debe contener el enlace de verificación sin imprimirlo.',
    );
    return result[1]!;
  };
  const ownBucket = (email: string) =>
    abuseDigest(config.abuseSecret, 'email_identity', email);
  return {
    received,
    logs,
    service,
    config,
    app,
    post,
    data,
    token,
    ownBucket,
    async allowResend(email: string) {
      await pool.query(
        "DELETE FROM fcmatch.login_attempts WHERE scope = 'email_identity' AND key_hash = $1",
        [ownBucket(email)],
      );
      await pool.query(
        `INSERT INTO fcmatch.login_attempts (scope, key_hash, attempts, window_started_at, created_at, updated_at, expires_at)
        VALUES ('email_identity', $1, 1, CURRENT_TIMESTAMP - interval '61 seconds', CURRENT_TIMESTAMP - interval '61 seconds', CURRENT_TIMESTAMP - interval '61 seconds', CURRENT_TIMESTAMP + interval '1 hour')`,
        [ownBucket(email)],
      );
    },
    async close() {
      mail.close();
      if (mode !== 'offline')
        await new Promise<void>((resolve) => smtp.close(() => resolve()));
      await pool.query(
        'DELETE FROM fcmatch.action_tokens WHERE user_id IN (SELECT id FROM fcmatch.users WHERE email = ANY($1::text[]))',
        [emails],
      );
      await pool.query(
        'DELETE FROM fcmatch.users WHERE email = ANY($1::text[])',
        [emails],
      );
      const keys = [
        ...emails.map(ownBucket),
        abuseDigest(config.abuseSecret, 'email_ip', '127.0.0.1'),
        abuseDigest(config.abuseSecret, 'email_ip', '::ffff:127.0.0.1'),
      ];
      await pool.query(
        'DELETE FROM fcmatch.login_attempts WHERE key_hash = ANY($1::bytea[])',
        [keys],
      );
    },
  };
}

test('registro real: SMTP, Argon2id, hash/TTL, confirmación explícita y ninguna sesión', async () => {
  const f = await fixture();
  try {
    const input = f.data();
    const started = performance.now();
    const response = await f
      .post('register', { ...input, email: ` ${input.email.toUpperCase()} ` })
      .expect(202);
    assert.ok(
      performance.now() - started >= 5900,
      'La aceptación aplica un piso temporal común.',
    );
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['set-cookie'], undefined);
    assert.deepEqual(Object.keys(response.body), ['message']);
    assert.equal(f.received.length, 1);
    const token = f.token();
    assert.ok(!JSON.stringify(response.body).includes(token));
    const user = (
      await pool.query('SELECT * FROM fcmatch.users WHERE email = $1', [
        input.email,
      ])
    ).rows[0];
    assert.equal(await verify(user.password_hash, input.password), true);
    assert.equal(user.email_verified_at, null);
    assert.notEqual(user.id, user.public_id);
    const action = (
      await pool.query(
        'SELECT * FROM fcmatch.action_tokens WHERE user_id = $1',
        [user.id],
      )
    ).rows[0];
    assert.deepEqual(action.token_hash, tokenDigest(token));
    assert.equal(action.token_hash.length, 32);
    assert.equal(
      action.expires_at.getTime() - action.created_at.getTime(),
      86_400_000,
    );
    await request(f.app)
      .get(`/api/v1/auth/verify-email?token=${token}`)
      .expect(404);
    assert.equal(
      (
        await pool.query(
          'SELECT email_verified_at FROM fcmatch.users WHERE id = $1',
          [user.id],
        )
      ).rows[0].email_verified_at,
      null,
    );
    await f.post('verify-email', { token }).expect(204);
    assert.ok(
      (
        await pool.query(
          'SELECT email_verified_at FROM fcmatch.users WHERE id = $1',
          [user.id],
        )
      ).rows[0].email_verified_at,
    );
    await f.post('verify-email', { token }).expect(400);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM fcmatch.sessions WHERE user_id = $1',
          [user.id],
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await f.close();
  }
});

test('registro real: duplicado genérico no cambia contraseña ni username; conflicto público y abuso silencioso', async () => {
  const f = await fixture();
  try {
    const input = f.data();
    const original = await f.post('register', input).expect(202);
    await f.allowResend(input.email);
    const duplicate = await f
      .post('register', {
        ...input,
        username: f.data().username,
        password: 'Contraseña diferente deliberada',
      })
      .expect(202);
    assert.deepEqual(duplicate.body, original.body);
    assert.equal(f.received.length, 1);
    const user = (
      await pool.query(
        'SELECT username, password_hash FROM fcmatch.users WHERE email = $1',
        [input.email],
      )
    ).rows[0];
    assert.equal(user.username, input.username);
    assert.equal(await verify(user.password_hash, input.password), true);
    const other = f.data();
    await f
      .post('register', { ...other, username: input.username.toUpperCase() })
      .expect(409);
    const resend = await f
      .post('resend-verification', { email: input.email })
      .expect(202);
    const missing = f.data();
    const absent = await f
      .post('resend-verification', { email: missing.email })
      .expect(202);
    assert.deepEqual(resend.body, absent.body);
    assert.equal(f.received.length, 1);
  } finally {
    await f.close();
  }
});

test('registro real: reenvío tras cooldown conserva enlace anterior e invalida hermanos al confirmar', async () => {
  const f = await fixture();
  try {
    const input = f.data();
    await f.post('register', input).expect(202);
    const old = f.token();
    await f.post('resend-verification', { email: input.email }).expect(202);
    assert.equal(f.received.length, 1);
    await f.allowResend(input.email);
    await f.post('resend-verification', { email: input.email }).expect(202);
    assert.equal(f.received.length, 2);
    const newer = f.token(1);
    await f.post('verify-email', { token: old }).expect(204);
    await f.post('verify-email', { token: newer }).expect(400);
    const sibling = (
      await pool.query(
        'SELECT revoked_at, used_at FROM fcmatch.action_tokens WHERE token_hash = $1',
        [tokenDigest(newer)],
      )
    ).rows[0];
    assert.ok(sibling.revoked_at);
    assert.equal(sibling.used_at, null);
    await f.allowResend(input.email);
    await f.post('resend-verification', { email: input.email }).expect(202);
    assert.equal(f.received.length, 2);
  } finally {
    await f.close();
  }
});

test('registro real: dos confirmaciones concurrentes (mismo token y hermanos) solo confirman una vez', async () => {
  const f = await fixture();
  try {
    for (const sibling of [false, true]) {
      const input = f.data();
      await f.post('register', input).expect(202);
      const first = f.token(f.received.length - 1);
      const second = sibling ? randomBytes(32).toString('base64url') : first;
      if (sibling)
        await pool.query(
          `INSERT INTO fcmatch.action_tokens (user_id, purpose, token_hash, expires_at)
        SELECT id, 'verify_email', $2, CURRENT_TIMESTAMP + interval '1 hour' FROM fcmatch.users WHERE email = $1`,
          [input.email, tokenDigest(second)],
        );
      const results = await Promise.all([
        f.post('verify-email', { token: first }),
        f.post('verify-email', { token: second }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [204, 400]);
      const counts = (
        await pool.query(
          `SELECT count(*) FILTER (WHERE used_at IS NOT NULL)::int AS used
        FROM fcmatch.action_tokens WHERE user_id = (SELECT id FROM fcmatch.users WHERE email = $1)`,
          [input.email],
        )
      ).rows[0];
      assert.equal(counts.used, 1);
    }
  } finally {
    await f.close();
  }
});

test('registro real: tokens inexistentes, vencidos y otra finalidad comparten 400 sin verificar', async () => {
  const f = await fixture();
  try {
    const input = f.data();
    await f.post('register', input).expect(202);
    const expired = randomBytes(32).toString('base64url');
    const wrong = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO fcmatch.action_tokens (user_id, purpose, token_hash, created_at, updated_at, expires_at)
      SELECT id, 'verify_email', $2, CURRENT_TIMESTAMP - interval '25 hours', CURRENT_TIMESTAMP - interval '25 hours', CURRENT_TIMESTAMP - interval '1 hour' FROM fcmatch.users WHERE email = $1`,
      [input.email, tokenDigest(expired)],
    );
    await pool.query(
      `INSERT INTO fcmatch.action_tokens (user_id, purpose, token_hash, expires_at)
      SELECT id, 'reset_password', $2, CURRENT_TIMESTAMP + interval '15 minutes' FROM fcmatch.users WHERE email = $1`,
      [input.email, tokenDigest(wrong)],
    );
    const bodies = [];
    for (const token of [expired, wrong, randomBytes(32).toString('base64url')])
      bodies.push((await f.post('verify-email', { token }).expect(400)).body);
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[1], bodies[2]);
    assert.equal(
      (
        await pool.query(
          'SELECT email_verified_at FROM fcmatch.users WHERE email = $1',
          [input.email],
        )
      ).rows[0].email_verified_at,
      null,
    );
  } finally {
    await f.close();
  }
});

for (const mode of ['reject', 'ambiguous'] as const)
  test(`registro real: SMTP ${mode} conserva cuenta/token y aceptación genérica`, async () => {
    const f = await fixture(mode);
    try {
      const input = f.data();
      const response = await f.post('register', input).expect(202);
      assert.deepEqual(Object.keys(response.body), ['message']);
      assert.equal(f.received.length, 1);
      assert.equal(f.logs.length, 1);
      assert.ok(!f.logs.join('').includes(input.email));
      const token = f.token();
      await f.post('verify-email', { token }).expect(204);
    } finally {
      await f.close();
    }
  });

test('registro real: límite IP concurrente durable y límite por identidad incluso inexistente', async () => {
  const f = await fixture();
  try {
    const input = f.data();
    await pool.query(
      `INSERT INTO fcmatch.login_attempts (scope, key_hash, attempts, expires_at)
      VALUES ('email_identity', $1, 5, CURRENT_TIMESTAMP + interval '1 hour')`,
      [f.ownBucket(input.email)],
    );
    await f.post('register', input).expect(202);
    assert.equal(
      (
        await pool.query('SELECT 1 FROM fcmatch.users WHERE email = $1', [
          input.email,
        ])
      ).rowCount,
      0,
    );
    const ip = abuseDigest(f.config.abuseSecret, 'email_ip', '127.0.0.1');
    await pool.query(
      "UPDATE fcmatch.login_attempts SET attempts = 9 WHERE scope = 'email_ip' AND key_hash = $1",
      [ip],
    );
    const a = f.data();
    const b = f.data();
    const responses = await Promise.all([
      f.post('resend-verification', { email: a.email }),
      f.post('resend-verification', { email: b.email }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [202, 429]);
    assert.ok(
      Number(responses.find((r) => r.status === 429)!.headers['retry-after']) >
        0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT attempts FROM fcmatch.login_attempts WHERE scope = 'email_ip' AND key_hash = $1",
          [ip],
        )
      ).rows[0].attempts,
      10,
    );
    const spoofed = await f
      .post('resend-verification', { email: a.email })
      .set('X-Forwarded-For', '192.0.2.30')
      .expect(429);
    assert.ok(spoofed.headers['retry-after']);
    assert.equal(f.received.length, 0);
  } finally {
    await f.close();
  }
});

test('registro real: SMTP sin conexión conserva solicitud y token sin filtrar estado', async () => {
  const f = await fixture('offline');
  try {
    const input = f.data();
    const response = await f.post('register', input).expect(202);
    assert.deepEqual(Object.keys(response.body), ['message']);
    assert.equal(f.logs.length, 1);
    const result = await pool.query(
      `SELECT u.email_verified_at, t.used_at, t.revoked_at FROM fcmatch.users u
      JOIN fcmatch.action_tokens t ON t.user_id = u.id WHERE u.email = $1`,
      [input.email],
    );
    assert.equal(result.rowCount, 1);
    assert.deepEqual(result.rows[0], {
      email_verified_at: null,
      used_at: null,
      revoked_at: null,
    });
  } finally {
    await f.close();
  }
});

test('registro real: altas concurrentes no duplican correo ni username público', async () => {
  const f = await fixture();
  try {
    const a = f.data();
    const b = f.data();
    const results = await Promise.all([
      f.post('register', a),
      f.post('register', { ...b, username: a.username.toUpperCase() }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [202, 409]);
    const c = f.data();
    const responses = await Promise.all([
      f.post('register', c),
      f.post('register', { ...c, username: f.data().username }),
    ]);
    assert.deepEqual(
      responses.map((r) => r.status),
      [202, 202],
    );
    assert.equal(
      (
        await pool.query('SELECT 1 FROM fcmatch.users WHERE email = $1', [
          c.email,
        ])
      ).rowCount,
      1,
    );
    assert.equal(f.received.length, 2);
  } finally {
    await f.close();
  }
});

test('registro real: fallo transaccional revierte usuario/token y no envía SMTP', async () => {
  const f = await fixture();
  try {
    class BrokenRepository extends IdentityRepository {
      override async createVerification() {
        throw new Error('fallo SQL con secreto no publicable');
      }
    }
    let sent = 0;
    const service = new RegistrationService(
      new BrokenRepository(pool),
      createPasswordHasher(),
      async () => {
        sent++;
      },
      f.config.abuseSecret,
    );
    const input = f.data();
    await assert.rejects(
      service.register(input, '127.0.0.1'),
      (error: unknown) => {
        assert.ok(
          error instanceof Error && 'status' in error && error.status === 503,
        );
        assert.ok(!error.message.includes('secreto'));
        return true;
      },
    );
    assert.equal(
      (
        await pool.query('SELECT 1 FROM fcmatch.users WHERE email = $1', [
          input.email,
        ])
      ).rowCount,
      0,
    );
    assert.equal(sent, 0);
    assert.equal(f.received.length, 0);
  } finally {
    await f.close();
  }
});

test('registro real: vencimiento de ventana permite reintentar sin bloqueo permanente', async () => {
  const f = await fixture();
  try {
    const input = f.data();
    await pool.query(
      `INSERT INTO fcmatch.login_attempts (scope, key_hash, attempts, window_started_at, created_at, updated_at, expires_at)
      VALUES ('email_identity', $1, 5, CURRENT_TIMESTAMP - interval '2 hours', CURRENT_TIMESTAMP - interval '2 hours', CURRENT_TIMESTAMP - interval '2 hours', CURRENT_TIMESTAMP - interval '1 hour')`,
      [f.ownBucket(input.email)],
    );
    await f.post('register', input).expect(202);
    assert.equal(f.received.length, 1);
    assert.equal(
      (
        await pool.query(
          "SELECT attempts FROM fcmatch.login_attempts WHERE scope = 'email_identity' AND key_hash = $1",
          [f.ownBucket(input.email)],
        )
      ).rows[0].attempts,
      1,
    );
  } finally {
    await f.close();
  }
});

test('registro real: reenvío y confirmación concurrentes no dejan tokens utilizables tras verificar', async () => {
  const f = await fixture();
  try {
    const input = f.data();
    await f.post('register', input).expect(202);
    const token = f.token();
    await f.allowResend(input.email);
    const results = await Promise.all([
      f.post('resend-verification', { email: input.email }),
      f.post('verify-email', { token }),
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      [202, 204],
    );
    const pending = await pool.query(
      `SELECT 1 FROM fcmatch.action_tokens
      WHERE user_id = (SELECT id FROM fcmatch.users WHERE email = $1) AND used_at IS NULL AND revoked_at IS NULL`,
      [input.email],
    );
    assert.equal(pending.rowCount, 0);
  } finally {
    await f.close();
  }
});
