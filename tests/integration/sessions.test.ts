import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { runner } from 'node-pg-migrate';
import type pg from 'pg';
import type { Express } from 'express';
import { createPool } from '../../src/shared/db/pool.js';
import { loadConfig } from '../../src/shared/config/env.js';
import { loadIdentityConfig } from '../../src/shared/config/identity.js';
import { createMailTransport } from '../../src/shared/mail/transport.js';
import { createApp } from '../../src/app.js';
import { IdentityRepository } from '../../src/modules/users/repository/identity.js';
import { SessionsRepository } from '../../src/modules/users/repository/sessions.js';
import {
  RegistrationService,
  abuseDigest,
  tokenDigest,
} from '../../src/modules/users/service/registration.js';
import { SessionsService } from '../../src/modules/users/service/sessions.js';
import {
  AccessTokens,
  type BrowserContext,
} from '../../src/modules/users/service/access-token.js';
import { createPasswordCrypto } from '../../src/modules/users/service/password.js';
import { createVerificationDelivery } from '../../src/modules/users/service/verification-mail.js';

const base = loadConfig();
let pool: pg.Pool;
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
    singleTransaction: true,
    checkOrder: true,
    log: () => {},
  });
  pool = createPool(base.TEST_DATABASE_URL);
});
after(async () => {
  if (pool) await pool.end();
});

class Browser {
  readonly cookies = new Map<string, string>();
  proof = '';
  access = '';
  constructor(
    readonly app: Express,
    readonly origin: string,
    readonly client: 'web' | 'mobile_browser' = 'web',
  ) {}
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  context(): BrowserContext {
    return {
      origin: this.origin,
      client: this.client,
      csrfFamily:
        (
          this.cookies.get(
            this.client === 'web' ? 'fcmatch_csrf_web' : 'fcmatch_csrf_mobile',
          ) ?? ''
        ).split('.')[2] ?? '',
    };
  }
  capture(response: request.Response) {
    for (const cookie of (response.headers['set-cookie'] ??
      []) as unknown as string[]) {
      const first = cookie.split(';')[0]!;
      const equal = first.indexOf('=');
      if (first.slice(equal + 1))
        this.cookies.set(first.slice(0, equal), first.slice(equal + 1));
      else this.cookies.delete(first.slice(0, equal));
    }
    if (response.body.csrfToken) this.proof = response.body.csrfToken;
    if (response.body.accessToken) this.access = response.body.accessToken;
    return response;
  }
  async bootstrap() {
    return this.capture(
      await request(this.app)
        .get('/api/v1/auth/csrf')
        .set('Origin', this.origin)
        .set('Cookie', this.header()),
    );
  }
  async post(path: string, body?: object, capture = true) {
    const req = request(this.app)
      .post(`/api/v1/auth/${path}`)
      .set('Origin', this.origin)
      .set('Cookie', this.header())
      .set('X-CSRF-Token', this.proof);
    if (this.access) req.set('Authorization', `Bearer ${this.access}`);
    if (body) req.send(body);
    const response = await req;
    return capture ? this.capture(response) : response;
  }
}
async function fixture(
  mode: 'accept' | 'reject' | 'ambiguous' | 'offline' = 'accept',
) {
  const messages: string[] = [];
  const logs: string[] = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        messages.push(Buffer.concat(chunks).toString('utf8'));
        if (mode === 'accept') callback();
        else if (mode === 'reject')
          callback(
            Object.assign(new Error('Rechazo sintético'), {
              responseCode: 550,
            }),
          );
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
  const passwords = await createPasswordCrypto();
  const tokens = new AccessTokens(
    randomBytes(32).toString('hex'),
    config.apiOrigin,
  );
  const send = (message: Parameters<typeof mail.sendMail>[0]) =>
    mail.sendMail(message);
  const registration = new RegistrationService(
    new IdentityRepository(pool),
    passwords.hash,
    createVerificationDelivery(send, base.SMTP_FROM, config.webOrigin),
    config.abuseSecret,
  );
  const service = new SessionsService(
    new SessionsRepository(pool),
    passwords,
    tokens,
    config.abuseSecret,
    registration,
    createVerificationDelivery(
      send,
      base.SMTP_FROM,
      config.webOrigin,
      (...parts) => logs.push(parts.join(' ')),
      'reset',
    ),
  );
  const app = createApp(
    { ...base, CORS_ORIGINS: [config.webOrigin, config.mobileOrigin] },
    pool,
    { service: registration, config, sessions: service },
  );
  const users: { id: string; email: string; password: string }[] = [];
  const extraEmails: string[] = [];
  const browser = new Browser(app, config.webOrigin);
  assert.equal((await browser.bootstrap()).status, 200);
  async function user(verified = true) {
    const seed = randomUUID().replaceAll('-', '');
    const email = `${seed}@fcmatch.test`;
    const password = 'Frase sintética de sesión 🏆';
    const result = await pool.query<{ id: string }>(
      `INSERT INTO fcmatch.users (email, username, password_hash, email_verified_at)
      VALUES ($1,$2,$3,CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE NULL END) RETURNING id`,
      [
        email,
        `s_${seed.slice(0, 24)}`,
        await passwords.hash(password),
        verified,
      ],
    );
    const value = { id: result.rows[0]!.id, email, password };
    users.push(value);
    return value;
  }
  return {
    app,
    config,
    browser,
    service,
    registration,
    passwords,
    tokens,
    user,
    messages,
    logs,
    missingEmail() {
      const email = `${randomUUID()}@fcmatch.test`;
      extraEmails.push(email);
      return email;
    },
    async login(who: Awaited<ReturnType<typeof user>>, target = browser) {
      const result = await target.post('login', {
        email: who.email,
        password: who.password,
      });
      assert.equal(result.status, 200);
      return result;
    },
    token(index = messages.length - 1) {
      const value = messages[index]!.replace(/=\r?\n/g, '')
        .replace(/=3D/g, '=')
        .match(/#token=([A-Za-z0-9_-]{43})/);
      assert.ok(value, 'SMTP debe contener un token sin imprimirlo.');
      return value[1]!;
    },
    async allowMail(email: string) {
      await pool.query(
        "DELETE FROM fcmatch.login_attempts WHERE scope = 'email_identity' AND key_hash = $1",
        [abuseDigest(config.abuseSecret, 'email_identity', email)],
      );
    },
    async close() {
      mail.close();
      if (mode !== 'offline')
        await new Promise<void>((resolve) => smtp.close(() => resolve()));
      const ids = users.map((u) => u.id);
      await pool.query(
        'DELETE FROM fcmatch.action_tokens WHERE user_id = ANY($1::uuid[])',
        [ids],
      );
      await pool.query(
        'DELETE FROM fcmatch.sessions WHERE user_id = ANY($1::uuid[])',
        [ids],
      );
      await pool.query('DELETE FROM fcmatch.users WHERE id = ANY($1::uuid[])', [
        ids,
      ]);
      const keys = [...users.map((u) => u.email), ...extraEmails].flatMap(
        (email) =>
          ['login_identity', 'email_identity'].map((scope) =>
            abuseDigest(config.abuseSecret, scope, email),
          ),
      );
      for (const scope of ['login_ip', 'email_ip'])
        for (const ip of ['127.0.0.1', '::ffff:127.0.0.1'])
          keys.push(abuseDigest(config.abuseSecret, scope, ip));
      await pool.query(
        'DELETE FROM fcmatch.login_attempts WHERE key_hash = ANY($1::bytea[])',
        [keys],
      );
    },
  };
}

test('sesiones reales: login verificado, JWT en memoria, cookie privada y refresh solo hash', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    const response = await f.login(user);
    assert.deepEqual(
      Object.keys(response.body).sort(),
      [
        'accessToken',
        'tokenType',
        'expiresIn',
        'sessionExpiresAt',
        'csrfToken',
        'csrfExpiresAt',
      ].sort(),
    );
    assert.equal(response.headers['cache-control'], 'no-store');
    const cookies = response.headers['set-cookie'] as unknown as string[];
    assert.ok(
      cookies.some(
        (c) =>
          c.startsWith('fcmatch_refresh_web=') &&
          c.includes('HttpOnly') &&
          c.includes('SameSite=Strict') &&
          c.includes('Path=/api/v1/auth'),
      ),
    );
    const rows = await pool.query(
      'SELECT *, expires_at - created_at AS duration FROM fcmatch.sessions WHERE user_id = $1',
      [user.id],
    );
    assert.equal(rows.rowCount, 1);
    assert.deepEqual(
      rows.rows[0].refresh_token_hash,
      tokenDigest(f.browser.cookies.get('fcmatch_refresh_web')!),
    );
    assert.equal(
      rows.rows[0].expires_at.getTime() - rows.rows[0].created_at.getTime(),
      30 * 86_400_000,
    );
    const authenticated = await f.service.authenticate(
      f.browser.access,
      f.browser.context(),
    );
    assert.equal(authenticated.user.id, user.id);
    const proof = f.browser.proof;
    const cookie = f.browser.header();
    await f.browser.bootstrap();
    assert.ok(
      f.browser.proof === proof && f.browser.header() === cookie,
      'Bootstrap no invalida pestañas del mismo contexto.',
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: inexistente, contraseña incorrecta y correo sin verificar comparten 401', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    const unverified = await f.user(false);
    const bodies = [];
    for (const body of [
      { email: user.email, password: 'Contraseña incorrecta' },
      { email: unverified.email, password: unverified.password },
      { email: f.missingEmail(), password: user.password },
    ]) {
      const result = await f.browser.post('login', body);
      assert.equal(result.status, 401);
      bodies.push(result.body);
      assert.equal(result.headers['set-cookie'], undefined);
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[1], bodies[2]);
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM fcmatch.sessions WHERE user_id = ANY($1::uuid[])',
          [[user.id, unverified.id]],
        )
      ).rowCount,
      0,
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: rotación conserva vencimiento; replay revoca familia y access ya emitido', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    const old = f.browser.cookies.get('fcmatch_refresh_web')!;
    const firstAccess = f.browser.access;
    const original = (
      await pool.query(
        'SELECT expires_at FROM fcmatch.sessions WHERE user_id = $1',
        [user.id],
      )
    ).rows[0].expires_at;
    assert.equal((await f.browser.post('refresh')).status, 200);
    assert.ok(old !== f.browser.cookies.get('fcmatch_refresh_web'));
    const rows = (
      await pool.query(
        'SELECT expires_at, consumed_at FROM fcmatch.sessions WHERE user_id = $1',
        [user.id],
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((r) => r.consumed_at).length, 1);
    assert.ok(rows.every((r) => r.expires_at.getTime() === original.getTime()));
    await f.service.authenticate(firstAccess, f.browser.context());
    f.browser.cookies.set('fcmatch_refresh_web', old);
    assert.equal((await f.browser.post('refresh')).status, 401);
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM fcmatch.sessions WHERE user_id = $1 AND revoked_at IS NULL',
          [user.id],
        )
      ).rowCount,
      0,
    );
    await assert.rejects(
      f.service.authenticate(f.browser.access, f.browser.context()),
      { status: 401 },
    );
    await assert.rejects(
      f.service.authenticate(firstAccess, f.browser.context()),
      { status: 401 },
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: dos renovaciones simultáneas no producen dos éxitos y revocan de forma durable', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    const results = await Promise.all([
      f.browser.post('refresh', undefined, false),
      f.browser.post('refresh', undefined, false),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM fcmatch.sessions WHERE user_id = $1 AND revoked_at IS NULL',
          [user.id],
        )
      ).rowCount,
      0,
    );
    await assert.rejects(
      f.service.authenticate(f.browser.access, f.browser.context()),
      { status: 401 },
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: pérdida de respuesta no permite reintentar el refresh viejo', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    assert.equal(
      (await f.browser.post('refresh', undefined, false)).status,
      200,
    ); // Respuesta descartada, cookie local permanece anterior.
    assert.equal((await f.browser.post('refresh')).status, 401);
    await assert.rejects(
      f.service.authenticate(f.browser.access, f.browser.context()),
      { status: 401 },
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: logout idempotente, logout-all y access emitido antes del cierre', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    const access = f.browser.access;
    const context = f.browser.context();
    assert.equal((await f.browser.post('logout')).status, 204);
    assert.equal(f.browser.cookies.size, 0);
    await assert.rejects(f.service.authenticate(access, context), {
      status: 401,
    });
    await f.browser.bootstrap();
    assert.equal((await f.browser.post('logout')).status, 204);
    await f.browser.bootstrap();
    await f.login(user);
    const second = new Browser(f.app, f.config.webOrigin);
    await second.bootstrap();
    await f.login(user, second);
    assert.equal((await f.browser.post('logout-all')).status, 204);
    await assert.rejects(
      f.service.authenticate(second.access, second.context()),
      { status: 401 },
    );
    assert.equal((await second.post('refresh')).status, 401);
  } finally {
    await f.close();
  }
});
test('sesiones reales: contextos web/móvil separados, CSRF falso no rota y Bearer no cruza origen', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    const anonProof = f.browser.proof;
    await f.login(user);
    assert.ok(f.browser.proof !== anonProof);
    const mobile = new Browser(f.app, f.config.mobileOrigin, 'mobile_browser');
    await mobile.bootstrap();
    await f.login(user, mobile);
    assert.ok(
      mobile.cookies.has('fcmatch_refresh_mobile') &&
        !mobile.cookies.has('fcmatch_refresh_web'),
    );
    await assert.rejects(
      f.service.authenticate(f.browser.access, mobile.context()),
      { status: 401 },
    );
    const proof = f.browser.proof;
    f.browser.proof = anonProof;
    assert.equal((await f.browser.post('refresh')).status, 403);
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM fcmatch.sessions WHERE user_id = $1 AND consumed_at IS NOT NULL',
          [user.id],
        )
      ).rowCount,
      0,
    );
    f.browser.proof = proof;
    const invalid = await f.browser.post('refresh', {
      refreshToken: 'no permitido',
    });
    assert.equal(invalid.status, 422);
    assert.equal(
      (await f.browser.post('refresh?refreshToken=no-permitido')).status,
      422,
    );
    assert.equal((await f.browser.post('logout')).status, 204);
    assert.equal((await mobile.post('refresh')).status, 200);
  } finally {
    await f.close();
  }
});
test('sesiones reales: bloqueo temporal tras diez fallos y límite IP persistente', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await f.browser.post('login', {
            email: user.email,
            password: 'Incorrecta sintética',
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await f.browser.post('login', {
          email: user.email,
          password: user.password,
        })
      ).status,
      401,
    );
    const key = abuseDigest(f.config.abuseSecret, 'login_identity', user.email);
    const row = (
      await pool.query(
        "SELECT locked_until, clock_timestamp() AS now FROM fcmatch.login_attempts WHERE scope = 'login_identity' AND key_hash = $1",
        [key],
      )
    ).rows[0];
    assert.ok(row.locked_until > row.now);
    await pool.query(
      "DELETE FROM fcmatch.login_attempts WHERE scope = 'login_identity' AND key_hash = $1",
      [key],
    );
    await f.login(user);
    const ip = (
      await pool.query(
        "SELECT key_hash FROM fcmatch.login_attempts WHERE scope = 'login_ip' AND key_hash = ANY($1::bytea[])",
        [
          ['127.0.0.1', '::ffff:127.0.0.1'].map((value) =>
            abuseDigest(f.config.abuseSecret, 'login_ip', value),
          ),
        ],
      )
    ).rows[0].key_hash;
    await pool.query(
      "UPDATE fcmatch.login_attempts SET attempts = 30 WHERE scope = 'login_ip' AND key_hash = $1",
      [ip],
    );
    const response = await f.browser.post('login', {
      email: user.email,
      password: user.password,
    });
    assert.equal(response.status, 429);
    assert.ok(response.headers['retry-after']);
  } finally {
    await f.close();
  }
});
test('sesiones reales: recuperación SMTP, TTL 30 min, consumo único y revocación total', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    assert.equal(
      (await f.browser.post('forgot-password', { email: user.email })).status,
      202,
    );
    const token = f.token();
    const row = (
      await pool.query(
        "SELECT * FROM fcmatch.action_tokens WHERE user_id = $1 AND purpose = 'reset_password'",
        [user.id],
      )
    ).rows[0];
    assert.deepEqual(row.token_hash, tokenDigest(token));
    assert.equal(
      row.expires_at.getTime() - row.created_at.getTime(),
      1_800_000,
    );
    const old = f.browser.access;
    const oldContext = f.browser.context();
    const newPassword = 'Contraseña renovada sintética 🏆';
    assert.equal(
      (await f.browser.post('reset-password', { token, newPassword })).status,
      204,
    );
    await assert.rejects(f.service.authenticate(old, oldContext), {
      status: 401,
    });
    await f.browser.bootstrap();
    assert.equal(
      (await f.browser.post('reset-password', { token, newPassword })).status,
      400,
    );
    assert.equal(
      (
        await f.browser.post('login', {
          email: user.email,
          password: user.password,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.browser.post('login', {
          email: user.email,
          password: newPassword,
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: cambio requiere contraseña actual, invalida access/refresh y tokens pendientes', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    assert.equal(
      (
        await f.browser.post('change-password', {
          currentPassword: 'Incorrecta',
          newPassword: 'Nueva contraseña sintética',
        })
      ).status,
      401,
    );
    const old = f.browser.access;
    const context = f.browser.context();
    await f.service.authenticate(old, context);
    assert.equal(
      (await f.browser.post('forgot-password', { email: user.email })).status,
      202,
    );
    const token = f.token();
    assert.equal(
      (
        await f.browser.post('change-password', {
          currentPassword: user.password,
          newPassword: 'Nueva contraseña sintética',
        })
      ).status,
      204,
    );
    await assert.rejects(f.service.authenticate(old, context), { status: 401 });
    await f.browser.bootstrap();
    assert.equal(
      (
        await f.browser.post('reset-password', {
          token,
          newPassword: 'Otra contraseña sintética',
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: reset simultáneo de tokens hermanos solo cambia una vez', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    await f.browser.post('forgot-password', { email: user.email });
    const first = f.token();
    await f.allowMail(user.email);
    await f.browser.post('forgot-password', { email: user.email });
    const second = f.token();
    const results = await Promise.all([
      f.browser.post(
        'reset-password',
        { token: first, newPassword: 'Cambio sintético número uno' },
        false,
      ),
      f.browser.post(
        'reset-password',
        { token: second, newPassword: 'Cambio sintético número dos' },
        false,
      ),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [204, 400]);
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM fcmatch.sessions WHERE user_id = $1 AND revoked_at IS NULL',
          [user.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM fcmatch.action_tokens WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NOT NULL",
          [user.id],
        )
      ).rowCount,
      1,
    );
  } finally {
    await f.close();
  }
});
for (const mode of ['reject', 'ambiguous', 'offline'] as const)
  test(`sesiones reales: recuperación SMTP ${mode} conserva token y aceptación`, async () => {
    const f = await fixture(mode);
    try {
      const user = await f.user();
      const response = await f.browser.post('forgot-password', {
        email: user.email,
      });
      assert.equal(response.status, 202);
      assert.deepEqual(Object.keys(response.body), ['message']);
      assert.equal(f.logs.length, 1);
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM fcmatch.action_tokens WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL AND revoked_at IS NULL",
            [user.id],
          )
        ).rowCount,
        1,
      );
      if (mode !== 'offline')
        assert.equal(
          (
            await f.browser.post('reset-password', {
              token: f.token(),
              newPassword: 'Recuperación sintética posterior',
            })
          ).status,
          204,
        );
    } finally {
      await f.close();
    }
  });

test('sesiones reales: refresh vencido y aleatorio no emiten sesiones ni revocan familias ajenas', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    const original = f.browser.cookies.get('fcmatch_refresh_web')!;
    const originalAccess = f.browser.access;
    const context = f.browser.context();
    f.browser.cookies.set(
      'fcmatch_refresh_web',
      randomBytes(32).toString('base64url'),
    );
    assert.equal((await f.browser.post('refresh')).status, 401);
    await f.service.authenticate(originalAccess, context);
    assert.equal((await f.browser.post('logout')).status, 204);
    await f.service.authenticate(originalAccess, context);
    f.browser.cookies.set('fcmatch_refresh_web', original);
    await f.browser.bootstrap();
    assert.equal((await f.browser.post('refresh')).status, 200);
    const expired = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await pool.query(
      `INSERT INTO fcmatch.sessions
      (id, family_id, user_id, refresh_token_hash, client_context, client_origin, device, created_at, updated_at, expires_at)
      VALUES ($1,$1,$2,$3,'web',$4,'Prueba vencida',CURRENT_TIMESTAMP - interval '31 days',CURRENT_TIMESTAMP - interval '31 days',CURRENT_TIMESTAMP - interval '1 day')`,
      [id, user.id, tokenDigest(expired), f.config.webOrigin],
    );
    f.browser.cookies.set('fcmatch_refresh_web', expired);
    await f.browser.bootstrap();
    assert.equal((await f.browser.post('refresh')).status, 401);
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM fcmatch.sessions WHERE family_id = $1',
          [id],
        )
      ).rowCount,
      1,
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: refresh concurrente con logout-all o reset queda inutilizable', async () => {
  const f = await fixture();
  try {
    for (const reset of [false, true]) {
      const user = await f.user();
      await f.browser.bootstrap();
      await f.login(user);
      let token = '';
      if (reset) {
        await f.browser.post('forgot-password', { email: user.email });
        token = f.token();
      }
      const access = f.browser.access;
      const context = f.browser.context();
      const results = await Promise.all([
        f.browser.post('refresh', undefined, false),
        reset
          ? f.browser.post(
              'reset-password',
              { token, newPassword: 'Clave sintética simultánea' },
              false,
            )
          : f.browser.post('logout-all', undefined, false),
      ]);
      assert.ok([200, 401].includes(results[0]!.status));
      assert.equal(results[1]!.status, 204);
      assert.equal(
        (
          await pool.query(
            'SELECT 1 FROM fcmatch.sessions WHERE user_id = $1 AND revoked_at IS NULL',
            [user.id],
          )
        ).rowCount,
        0,
      );
      await assert.rejects(f.service.authenticate(access, context), {
        status: 401,
      });
    }
  } finally {
    await f.close();
  }
});
test('sesiones reales: dos cambios concurrentes no sobrescriben credenciales ya renovadas', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    const responses = await Promise.all([
      f.browser.post(
        'change-password',
        {
          currentPassword: user.password,
          newPassword: 'Nueva clave concurrente uno',
        },
        false,
      ),
      f.browser.post(
        'change-password',
        {
          currentPassword: user.password,
          newPassword: 'Nueva clave concurrente dos',
        },
        false,
      ),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [204, 401]);
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM fcmatch.sessions WHERE user_id = $1 AND revoked_at IS NULL',
          [user.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: reset vencido, de otra finalidad o inexistente no cambia contraseña', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    const expired = randomBytes(32).toString('base64url');
    const other = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO fcmatch.action_tokens (user_id,purpose,token_hash,created_at,updated_at,expires_at)
      VALUES ($1,'reset_password',$2,CURRENT_TIMESTAMP - interval '31 minutes',CURRENT_TIMESTAMP - interval '31 minutes',CURRENT_TIMESTAMP - interval '1 minute'),
      ($1,'verify_email',$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + interval '1 hour')`,
      [user.id, tokenDigest(expired), tokenDigest(other)],
    );
    const bodies = [];
    for (const token of [
      expired,
      other,
      randomBytes(32).toString('base64url'),
    ]) {
      const response = await f.browser.post('reset-password', {
        token,
        newPassword: 'No debe aplicarse esta clave',
      });
      assert.equal(response.status, 400);
      bodies.push(response.body);
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[1], bodies[2]);
    await f.login(user);
  } finally {
    await f.close();
  }
});

test('sesiones reales: CSRF de otra familia, Origin ausente y Bearer ausente no autorizan efectos', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.browser.post('logout-all')).status, 401);
    const user = await f.user();
    await f.login(user);
    const second = new Browser(f.app, f.config.webOrigin);
    await second.bootstrap();
    await f.login(user, second);
    const own = f.browser.cookies.get('fcmatch_refresh_web')!;
    f.browser.cookies.set(
      'fcmatch_refresh_web',
      second.cookies.get('fcmatch_refresh_web')!,
    );
    assert.equal((await f.browser.post('refresh')).status, 403);
    f.browser.cookies.set('fcmatch_refresh_web', own);
    f.browser.access = second.access;
    assert.equal((await f.browser.post('logout-all')).status, 403);
    assert.equal(
      (
        await request(f.app)
          .post('/api/v1/auth/logout')
          .set('Cookie', second.header())
          .set('X-CSRF-Token', second.proof)
      ).status,
      403,
    );
    await f.service.authenticate(second.access, second.context());
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM fcmatch.sessions WHERE user_id = $1 AND revoked_at IS NOT NULL',
          [user.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await f.close();
  }
});
test('sesiones reales: cambiar contraseña comparte bloqueo temporal por identidad', async () => {
  const f = await fixture();
  try {
    const user = await f.user();
    await f.login(user);
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await f.browser.post('change-password', {
            currentPassword: 'Error sintético',
            newPassword: 'Contraseña que no se aplicará',
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await f.browser.post('change-password', {
          currentPassword: user.password,
          newPassword: 'No se aplicará durante bloqueo',
        })
      ).status,
      401,
    );
    await f.service.authenticate(f.browser.access, f.browser.context());
    const row = (
      await pool.query(
        "SELECT attempts, locked_until, clock_timestamp() AS now FROM fcmatch.login_attempts WHERE scope = 'login_identity' AND key_hash = $1",
        [abuseDigest(f.config.abuseSecret, 'login_identity', user.email)],
      )
    ).rows[0];
    assert.equal(row.attempts, 10);
    assert.ok(row.locked_until > row.now);
  } finally {
    await f.close();
  }
});

test('sesiones reales: recuperación no enumera inexistentes/no verificados y aplica cooldown', async () => {
  const f = await fixture();
  try {
    const noVerified = await f.user(false);
    const verified = await f.user();
    const results: unknown[] = [];
    for (const email of [
      f.missingEmail(),
      noVerified.email,
      verified.email,
      verified.email,
    ]) {
      const response = await f.browser.post('forgot-password', { email });
      assert.equal(response.status, 202);
      results.push(response.body);
    }
    assert.ok(
      results.every(
        (body) => JSON.stringify(body) === JSON.stringify(results[0]),
      ),
    );
    assert.equal(f.messages.length, 1);
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM fcmatch.action_tokens WHERE user_id = $1 AND purpose = 'reset_password'",
          [noVerified.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await f.close();
  }
});
