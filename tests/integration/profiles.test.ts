import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { SMTPServer } from 'smtp-server';
import { runner } from 'node-pg-migrate';
import sharp from 'sharp';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/shared/config/env.js';
import { loadIdentityConfig } from '../../src/shared/config/identity.js';
import { createPool } from '../../src/shared/db/pool.js';
import { createMailTransport } from '../../src/shared/mail/transport.js';
import {
  createAvatarStorage,
  type AvatarStorage,
} from '../../src/shared/storage/avatars.js';
import { IdentityRepository } from '../../src/modules/users/repository/identity.js';
import { SessionsRepository } from '../../src/modules/users/repository/sessions.js';
import { ProfilesRepository } from '../../src/modules/users/repository/profiles.js';
import {
  RegistrationService,
  abuseDigest,
} from '../../src/modules/users/service/registration.js';
import { SessionsService } from '../../src/modules/users/service/sessions.js';
import { ProfilesService } from '../../src/modules/users/service/profiles.js';
import { AccessTokens } from '../../src/modules/users/service/access-token.js';
import { createPasswordCrypto } from '../../src/modules/users/service/password.js';
import { createVerificationDelivery } from '../../src/modules/users/service/verification-mail.js';

const base = loadConfig();
const pool = createPool(base.TEST_DATABASE_URL!);
const users: {
  id: string;
  email: string;
  username: string;
  publicId: string;
}[] = [];
const destinations: string[] = [];
const messages: string[] = [];
const password = 'Frase sintética para perfiles 🏆';
let failStorage: '' | 'put' | 'put-after' | 'remove' | 'sign' = '';
let failDatabase = false;
let afterPut: (() => Promise<void>) | undefined;
let smtpMode: 'accept' | 'reject' | 'ambiguous' = 'accept';
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['AUTH', 'STARTTLS'],
  onData(stream, _session, callback) {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      messages.push(Buffer.concat(chunks).toString());
      if (smtpMode === 'accept') callback();
      else if (smtpMode === 'reject')
        callback(Object.assign(new Error('Sintético'), { responseCode: 550 }));
    });
  },
});
smtp.on('error', () => {});
const identity = loadIdentityConfig(
  { ...base, CORS_ORIGINS: ['http://localhost:4200', 'http://localhost:8100'] },
  {
    IDENTITY_CSRF_SECRET: randomBytes(32).toString('hex'),
    IDENTITY_ABUSE_SECRET: randomBytes(32).toString('hex'),
    IDENTITY_WEB_ORIGIN: 'http://localhost:4200',
    IDENTITY_MOBILE_ORIGIN: 'http://localhost:8100',
    IDENTITY_API_ORIGIN: 'http://localhost:3000',
  },
);
let mail: ReturnType<typeof createMailTransport>;
let real: NonNullable<ReturnType<typeof createAvatarStorage>>;
let profiles: ProfilesService;
let app: ReturnType<typeof createApp>;
let numericApp: ReturnType<typeof createApp>;
let passwords: Awaited<ReturnType<typeof createPasswordCrypto>>;
before(async () => {
  assert.ok(
    base.TEST_DATABASE_URL &&
      new URL(base.TEST_DATABASE_URL).pathname.endsWith('_test'),
  );
  assert.notEqual(base.TEST_DATABASE_URL, base.DATABASE_URL);
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
  const credentials = JSON.parse(
    await readFile('.local/storage/credentials.json', 'utf8'),
  );
  real = createAvatarStorage(
    loadConfig({
      ...process.env,
      STORAGE_PROVIDER: 's3-local',
      S3_ENDPOINT: 'http://127.0.0.1:8333',
      S3_BUCKET: 'fcmatch-test-avatars',
      S3_ACCESS_KEY_ID: credentials.test.accessKey,
      S3_SECRET_ACCESS_KEY: credentials.test.secretKey,
    }),
  )!;
  const storage: AvatarStorage = {
    async put(...args) {
      if (failStorage === 'put') throw new Error('Fallo sintético');
      await real.put(...args);
      if (failStorage === 'put-after')
        throw new Error('Respuesta perdida sintética tras escritura real.');
      await afterPut?.();
    },
    async remove(...args) {
      if (failStorage === 'remove') throw new Error('Fallo sintético');
      await real.remove(...args);
    },
    async sign(...args) {
      if (failStorage === 'sign') throw new Error('Fallo sintético');
      return real.sign(...args);
    },
  };
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  mail = createMailTransport({
    ...base,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: (smtp.server.address() as { port: number }).port,
    SMTP_SECURE: false,
    SMTP_USER: '',
    SMTP_PASSWORD: '',
  });
  passwords = await createPasswordCrypto();
  const send = (message: Parameters<typeof mail.sendMail>[0]) =>
    mail.sendMail(message);
  const registration = new RegistrationService(
    new IdentityRepository(pool),
    passwords.hash,
    createVerificationDelivery(send, base.SMTP_FROM, identity.webOrigin),
    identity.abuseSecret,
  );
  const sessions = new SessionsService(
    new SessionsRepository(pool),
    passwords,
    new AccessTokens(randomBytes(32).toString('hex'), identity.apiOrigin),
    identity.abuseSecret,
    registration,
    createVerificationDelivery(
      send,
      base.SMTP_FROM,
      identity.webOrigin,
      () => {},
      'reset',
    ),
  );
  class FaultRepository extends ProfilesRepository {
    override async activate(
      ...args: Parameters<ProfilesRepository['activate']>
    ) {
      await super.activate(...args);
      if (failDatabase)
        throw new Error('Fallo transaccional sintético después de SQL.');
    }
  }
  profiles = new ProfilesService(
    new FaultRepository(pool),
    sessions,
    registration,
    storage,
    identity.csrfSecret,
    createVerificationDelivery(
      send,
      base.SMTP_FROM,
      identity.webOrigin,
      () => {},
      'email-change',
    ),
  );
  app = createApp(
    { ...base, CORS_ORIGINS: [identity.webOrigin, identity.mobileOrigin] },
    pool,
    { service: registration, config: identity, sessions, profiles },
  );
  numericApp = createApp(
    { ...base, CORS_ORIGINS: [identity.webOrigin, identity.mobileOrigin] },
    pool,
    { service: registration, config: identity, sessions, profiles },
  );
});
after(async () => {
  failStorage = '';
  if (real) {
    for (const user of users) {
      await pool.query('UPDATE fcmatch.users SET avatar_key=NULL WHERE id=$1', [
        user.id,
      ]);
      await pool.query(
        "UPDATE fcmatch.avatar_objects SET state='retired' WHERE user_id=$1",
        [user.id],
      );
      await profiles.cleanup(user.id);
    }
    real.close();
  }
  const ids = users.map((u) => u.id);
  await pool.query(
    'DELETE FROM fcmatch.action_tokens WHERE user_id=ANY($1::uuid[])',
    [ids],
  );
  await pool.query(
    'DELETE FROM fcmatch.sessions WHERE user_id=ANY($1::uuid[])',
    [ids],
  );
  await pool.query('DELETE FROM fcmatch.users WHERE id=ANY($1::uuid[])', [ids]);
  const keys = [...users.map((u) => u.email), ...destinations].flatMap(
    (email) =>
      ['login_identity', 'email_identity'].map((scope) =>
        abuseDigest(identity.abuseSecret, scope, email),
      ),
  );
  for (const scope of ['login_ip', 'email_ip'])
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1'])
      keys.push(abuseDigest(identity.abuseSecret, scope, ip));
  await pool.query(
    'DELETE FROM fcmatch.login_attempts WHERE key_hash=ANY($1::bytea[])',
    [keys],
  );
  mail?.close();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
  await pool.end();
});
async function fixture(target = app) {
  const seed = randomUUID().replaceAll('-', '');
  const email = `${seed}@fcmatch.test`;
  const username = `pf_${seed.slice(0, 22)}`;
  const row = (
    await pool.query<{ id: string; public_id: string }>(
      `INSERT INTO fcmatch.users(email,username,password_hash,email_verified_at)VALUES($1,$2,$3,CURRENT_TIMESTAMP) RETURNING id,public_id`,
      [email, username, await passwords.hash(password)],
    )
  ).rows[0]!;
  const user = { id: row.id, email, username, publicId: row.public_id };
  users.push(user);
  const cookies = new Map<string, string>();
  let proof = '';
  let access = '';
  const header = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const capture = (response: request.Response) => {
    for (const cookie of response.headers['set-cookie'] ?? []) {
      const first = cookie.split(';')[0]!;
      const equal = first.indexOf('=');
      cookies.set(first.slice(0, equal), first.slice(equal + 1));
    }
    if (response.body.csrfToken) proof = response.body.csrfToken;
    if (response.body.accessToken) access = response.body.accessToken;
    return response;
  };
  capture(
    await request(target)
      .get('/api/v1/auth/csrf')
      .set('Origin', identity.webOrigin),
  );
  const login = capture(
    await request(target)
      .post('/api/v1/auth/login')
      .set('Origin', identity.webOrigin)
      .set('Cookie', header())
      .set('X-CSRF-Token', proof)
      .send({ email, password }),
  );
  assert.equal(login.status, 200);
  const call = (
    method: 'get' | 'patch' | 'post' | 'put' | 'delete',
    path: string,
    body?: object,
  ) => {
    const client = request(target);
    const req = client[method](`/api/v1${path}`)
      .set('Origin', identity.webOrigin)
      .set('Cookie', header())
      .set('X-CSRF-Token', proof)
      .set('Authorization', `Bearer ${access}`);
    if (body) req.send(body);
    return req;
  };
  return {
    user,
    call,
    header,
    proof,
    access,
    context: () => ({
      origin: identity.webOrigin,
      client: 'web' as const,
      csrfFamily: cookies.get('fcmatch_csrf_web')!.split('.')[2]!,
    }),
  };
}
const image = () =>
  sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 1, g: 2, b: 3 },
    },
  })
    .png()
    .toBuffer();
const destination = () => {
  const value = `${randomUUID()}@fcmatch.test`;
  destinations.push(value);
  return value;
};
const token = () => {
  const match = messages
    .at(-1)!
    .replace(/=\r?\n/g, '')
    .replace(/=3D/g, '=')
    .match(/#token=([A-Za-z0-9_-]{43})/);
  assert.ok(match);
  return match[1]!;
};
const allowMail = async (email: string) =>
  pool.query(
    "DELETE FROM fcmatch.login_attempts WHERE scope='email_identity' AND key_hash=$1",
    [abuseDigest(identity.abuseSecret, 'email_identity', email)],
  );

test('perfiles reales: propio/público, privacidad, edición y publicId inmutable', async () => {
  const f = await fixture();
  const own = await f.call('get', '/users/me');
  assert.equal(own.status, 200);
  assert.deepEqual(Object.keys(own.body).sort(), [
    'email',
    'emailVerifiedAt',
    'profile',
  ]);
  assert.deepEqual(Object.keys(own.body.profile).sort(), [
    'avatar',
    'history',
    'leagueName',
    'publicId',
    'statistics',
    'username',
  ]);
  assert.equal(own.body.email, f.user.email);
  assert.equal(own.body.profile.publicId, f.user.publicId);
  assert.equal(own.body.profile.statistics, null);
  assert.deepEqual(own.body.profile.history, []);
  const publicProfile = await request(app).get(
    `/api/v1/users/${f.user.publicId}`,
  );
  assert.equal(publicProfile.status, 200);
  assert.deepEqual(
    Object.keys(publicProfile.body).sort(),
    [
      'publicId',
      'username',
      'leagueName',
      'avatar',
      'statistics',
      'history',
    ].sort(),
  );
  assert.equal(publicProfile.headers['cache-control'], 'no-store');
  const edit = await f.call('patch', '/users/me', {
    username: `z_${f.user.username}`,
    leagueName: ' Liga de prueba ',
  });
  assert.equal(edit.status, 200);
  assert.deepEqual(Object.keys(edit.body).sort(), [
    'email',
    'emailVerifiedAt',
    'profile',
  ]);
  assert.equal(edit.body.profile.leagueName, 'Liga de prueba');
  assert.equal(edit.body.profile.publicId, f.user.publicId);
  assert.equal(
    (await f.call('patch', '/users/me', { publicId: randomUUID() })).status,
    422,
  );
  assert.equal(
    (await f.call('patch', '/users/me', { email: 'arbitrary@fcmatch.test' }))
      .status,
    422,
  );
  assert.equal(
    (await f.call('patch', '/users/me', { leagueName: null })).body.profile
      .leagueName,
    null,
  );
  assert.equal(
    (await f.call('patch', '/users/me', { leagueName: '  ' })).status,
    422,
  );
  assert.equal((await request(app).get('/api/v1/users/me')).status, 401);
});
test('ID numérico real: negociación, enlaces UUID, privacidad, búsqueda exacta y autorización', async () => {
  const app = numericApp;
  const f = await fixture(app);
  const other = await fixture(app);
  const media = 'application/vnd.fcmatch.identity.v2+json';
  const own = await f.call('get', '/users/me').set('Accept', media);
  assert.equal(own.status, 200);
  assert.match(
    own.headers['content-type']!,
    /application\/vnd\.fcmatch\.identity\.v2\+json/,
  );
  assert.match(own.headers['vary']!, /Accept/);
  const number = own.body.profile.publicNumber;
  const missing = await request(app)
    .get('/api/v1/users/99999999')
    .set('Accept', media);
  assert.equal(missing.status, 404);
  assert.match(missing.headers['content-type']!, /^application\/json/);
  assert.match(number, /^[1-9][0-9]{7}$/);
  assert.equal(own.body.profile.publicId, f.user.publicId);
  for (const identifier of [number, f.user.publicId]) {
    const value = await request(app)
      .get(`/api/v1/users/${identifier}`)
      .set('Accept', media);
    assert.equal(value.status, 200);
    assert.equal(value.body.publicNumber, number);
    assert.equal(value.body.publicId, f.user.publicId);
    assert.equal(value.body.email, undefined);
    assert.equal(value.body.id, undefined);
  }
  const legacy = await f.call('get', '/users/me');
  assert.equal(legacy.body.profile.publicNumber, undefined);
  assert.equal(legacy.body.profile.publicId, f.user.publicId);
  const exact = await f
    .call('get', `/users?publicNumber=${number}`)
    .set('Accept', media);
  assert.equal(exact.status, 200);
  assert.equal(exact.body.items.length, 1);
  assert.equal(exact.body.items[0].publicNumber, number);
  assert.equal(exact.body.nextCursor, null);
  for (const query of [
    `publicNumber=${number}&search=pf`,
    `publicNumber=${number}&cursor=bad`,
    'publicNumber=01234567',
    'publicNumber=123456789',
    'publicNumber=1e7',
    'publicNumber=12345678%27',
  ])
    assert.equal((await f.call('get', `/users?${query}`)).status, 422);
  assert.equal(
    (await request(app).get(`/api/v1/users?publicNumber=${number}`)).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .get(`/api/v1/users/${number}`)
        .set('Authorization', `Bearer ${number}`)
    ).body.email,
    undefined,
  );
  assert.equal(
    (
      await request(app)
        .get('/api/v1/users/me')
        .set('Origin', identity.webOrigin)
        .set('Authorization', `Bearer ${number}`)
    ).status,
    401,
  );
  for (const body of [
    { publicNumber: '99999999' },
    { public_number: 99999999 },
    { publicId: number },
  ])
    assert.equal((await f.call('patch', '/users/me', body)).status, 422);
  const edit = await f
    .call('patch', '/users/me', { leagueName: 'Liga' })
    .set('Accept', media);
  assert.equal(edit.body.profile.publicNumber, number);
  const otherOwn = await other.call('get', '/users/me').set('Accept', media);
  assert.notEqual(otherOwn.body.profile.publicNumber, number);
  const page = await f.call('get', '/users?search=pf_&limit=1');
  assert.ok(page.body.nextCursor);
  const next = await f
    .call('get', `/users?search=pf_&limit=1&cursor=${page.body.nextCursor}`)
    .set('Accept', media);
  assert.equal(next.status, 200);
  assert.match(next.body.items[0].publicNumber, /^[1-9][0-9]{7}$/);
  // Un username de ocho dígitos no cambia el significado del filtro search.
  const numericName = otherOwn.body.profile.publicNumber;
  await f.call('patch', '/users/me', { username: numericName });
  const byName = await f
    .call('get', `/users?search=${numericName}`)
    .set('Accept', media);
  const byId = await f
    .call('get', `/users?publicNumber=${numericName}`)
    .set('Accept', media);
  assert.equal(byName.body.items[0].publicId, f.user.publicId);
  assert.equal(byId.body.items[0].publicId, other.user.publicId);
});

test('perfiles reales: usernames concurrentes y búsqueda con prefijo literal/cursor firmado', async () => {
  const a = await fixture();
  const b = await fixture();
  const name = `u_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const responses = await Promise.all([
    a.call('patch', '/users/me', { username: name }),
    b.call('patch', '/users/me', { username: name.toUpperCase() }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  await fixture();
  const page = await a.call('get', '/users?search=pf_&limit=1');
  assert.equal(page.status, 200);
  assert.equal(page.body.items.length, 1);
  assert.ok(page.body.nextCursor);
  const next = await a.call(
    'get',
    `/users?search=pf_&limit=1&cursor=${page.body.nextCursor}`,
  );
  assert.equal(next.status, 200);
  assert.notEqual(page.body.items[0].publicId, next.body.items[0].publicId);
  assert.equal(
    (await a.call('get', `/users?search=zz&cursor=${page.body.nextCursor}`))
      .status,
    422,
  );
  assert.equal(
    (await a.call('get', '/users?search=pf_&cursor=bad')).status,
    422,
  );
  assert.equal((await a.call('get', '/users?search=pf_&limit=51')).status, 422);
  assert.equal(
    (await request(app).get('/api/v1/users?search=pf_')).status,
    401,
  );
});
test('avatares reales: subir/leer/sustituir/borrar en S3 con privacidad y propiedad', async () => {
  const f = await fixture();
  const other = await fixture();
  const bytes = await image();
  const first = await f.call('put', '/users/me/avatar').attach('file', bytes, {
    filename: 'avatar.png',
    contentType: 'image/png',
  });
  assert.equal(first.status, 200);
  assert.equal((await fetch(first.body.url)).status, 200);
  const unsigned = new URL(first.body.url);
  unsigned.search = '';
  assert.equal((await fetch(unsigned)).status, 403);
  const profile = await request(app).get(`/api/v1/users/${f.user.publicId}`);
  assert.ok(profile.body.avatar.url);
  assert.equal(profile.body.avatar.key, undefined);
  assert.equal(
    (await other.call('delete', `/users/${f.user.publicId}/avatar`)).status,
    404,
  );
  assert.equal(
    (await other.call('get', '/users/me')).body.profile.avatar,
    null,
  );
  const second = await f.call('put', '/users/me/avatar').attach('file', bytes, {
    filename: 'ignored.jpg',
    contentType: 'image/png',
  });
  assert.equal(second.status, 200);
  assert.equal((await fetch(first.body.url)).status, 404);
  assert.equal((await f.call('delete', '/users/me/avatar')).status, 204);
  assert.equal((await fetch(second.body.url)).status, 404);
  assert.equal((await f.call('delete', '/users/me/avatar')).status, 204);
  assert.equal((await f.call('get', '/users/me')).body.profile.avatar, null);
});
test('avatares reales: errores de imagen/multipart/CSRF no modifican el perfil', async () => {
  const f = await fixture();
  const bytes = await image();
  assert.equal(
    (
      await f
        .call('put', '/users/me/avatar')
        .attach('file', Buffer.from('<svg/>'), {
          filename: 'fake.png',
          contentType: 'image/png',
        })
    ).status,
    415,
  );
  assert.equal(
    (
      await f
        .call('put', '/users/me/avatar')
        .attach('file', Buffer.alloc(5_242_881), {
          filename: 'large.png',
          contentType: 'image/png',
        })
    ).status,
    413,
  );
  assert.equal(
    (
      await f
        .call('put', '/users/me/avatar')
        .attach('file', bytes, {
          filename: 'first.png',
          contentType: 'image/png',
        })
        .attach('file', bytes, {
          filename: 'second.png',
          contentType: 'image/png',
        })
    ).status,
    422,
  );
  assert.equal(
    (
      await f
        .call('put', '/users/me/avatar')
        .field('userId', f.user.id)
        .attach('file', bytes, { filename: 'a.png', contentType: 'image/png' })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(app)
        .put('/api/v1/users/me/avatar')
        .attach('file', bytes, 'test.png')
    ).status,
    403,
  );
  assert.equal((await f.call('get', '/users/me')).body.profile.avatar, null);
});
test('avatares reales: fallos de almacenamiento conservan anterior y borrado reintentable', async () => {
  const f = await fixture();
  const bytes = await image();
  const first = await f
    .call('put', '/users/me/avatar')
    .attach('file', bytes, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(first.status, 200);
  for (const fail of ['put', 'put-after', 'sign'] as const) {
    failStorage = fail;
    const failed = await f
      .call('put', '/users/me/avatar')
      .attach('file', bytes, { filename: 'b.png', contentType: 'image/png' });
    assert.equal(failed.status, 503);
    failStorage = '';
    assert.equal((await fetch(first.body.url)).status, 200);
  }
  failStorage = 'remove';
  assert.equal((await f.call('delete', '/users/me/avatar')).status, 503);
  failStorage = '';
  assert.equal((await f.call('get', '/users/me')).body.profile.avatar, null);
  assert.ok(
    (
      await pool.query(
        "SELECT 1 FROM fcmatch.avatar_objects WHERE user_id=$1 AND state='retired'",
        [f.user.id],
      )
    ).rowCount,
  );
  assert.equal((await f.call('delete', '/users/me/avatar')).status, 204);
  assert.equal((await fetch(first.body.url)).status, 404);
});
test('avatares reales: dos sustituciones concurrentes dejan una sola foto activa', async () => {
  const f = await fixture();
  const bytes = await image();
  const responses = await Promise.all([
    f
      .call('put', '/users/me/avatar')
      .attach('file', bytes, { filename: 'a.png', contentType: 'image/png' }),
    f
      .call('put', '/users/me/avatar')
      .attach('file', bytes, { filename: 'b.png', contentType: 'image/png' }),
  ]);
  assert.ok(responses.every((r) => r.status === 200));
  const rows = await pool.query(
    'SELECT object_key,state FROM fcmatch.avatar_objects WHERE user_id=$1',
    [f.user.id],
  );
  assert.equal(rows.rows.filter((r) => r.state === 'active').length, 1);
  await profiles.cleanup(f.user.id);
  assert.equal(
    (
      await pool.query(
        'SELECT 1 FROM fcmatch.avatar_objects WHERE user_id=$1',
        [f.user.id],
      )
    ).rowCount,
    1,
  );
});
test('correo real: contraseña actual, titular, SMTP y confirmación única sin cambio anticipado', async () => {
  const f = await fixture();
  const other = await fixture();
  const email = destination();
  assert.equal(
    (
      await f.call('post', '/users/me/email-change', {
        newEmail: email,
        currentPassword: 'incorrecta',
      })
    ).status,
    401,
  );
  const send = await f.call('post', '/users/me/email-change', {
    newEmail: email,
    currentPassword: password,
  });
  assert.equal(send.status, 202);
  const value = token();
  assert.equal((await f.call('get', '/users/me')).body.email, f.user.email);
  assert.equal(
    (
      await other.call('post', '/users/me/email-change/confirm', {
        token: value,
      })
    ).status,
    400,
  );
  const confirmed = await f.call('post', '/users/me/email-change/confirm', {
    token: value,
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(Object.keys(confirmed.body).sort(), [
    'email',
    'emailVerifiedAt',
    'profile',
  ]);
  assert.equal(confirmed.body.email, email);
  assert.equal(
    (await f.call('post', '/users/me/email-change/confirm', { token: value }))
      .status,
    400,
  );
});
test('correo real: destinos distintos invalidan anterior; confirmación paralela consume una vez', async () => {
  const f = await fixture();
  const first = destination();
  const second = destination();
  await f.call('post', '/users/me/email-change', {
    newEmail: first,
    currentPassword: password,
  });
  const stale = token();
  await f.call('post', '/users/me/email-change', {
    newEmail: second,
    currentPassword: password,
  });
  const current = token();
  assert.equal(
    (await f.call('post', '/users/me/email-change/confirm', { token: stale }))
      .status,
    400,
  );
  const results = await Promise.all([
    f.call('post', '/users/me/email-change/confirm', { token: current }),
    f.call('post', '/users/me/email-change/confirm', { token: current }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
});
test('correo real: carrera de unicidad no enumera al titular del destino', async () => {
  const a = await fixture();
  const b = await fixture();
  const email = destination();
  await a.call('post', '/users/me/email-change', {
    newEmail: email,
    currentPassword: password,
  });
  const first = token();
  await allowMail(email);
  await b.call('post', '/users/me/email-change', {
    newEmail: email,
    currentPassword: password,
  });
  const second = token();
  const results = await Promise.all([
    a.call('post', '/users/me/email-change/confirm', { token: first }),
    b.call('post', '/users/me/email-change/confirm', { token: second }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.ok(
    results
      .filter((r) => r.status === 400)
      .every((r) => r.body.error.code === 'ACTION_TOKEN_INVALID'),
  );
});
test('avatares reales: rollback DB tras SQL conserva anterior y limpia objeto nuevo', async () => {
  const f = await fixture();
  const bytes = await image();
  const first = await f
    .call('put', '/users/me/avatar')
    .attach('file', bytes, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(first.status, 200);
  failDatabase = true;
  try {
    assert.equal(
      (
        await f.call('put', '/users/me/avatar').attach('file', bytes, {
          filename: 'b.png',
          contentType: 'image/png',
        })
      ).status,
      503,
    );
  } finally {
    failDatabase = false;
  }
  assert.equal((await fetch(first.body.url)).status, 200);
  assert.equal(
    (
      await pool.query(
        'SELECT 1 FROM fcmatch.avatar_objects WHERE user_id=$1',
        [f.user.id],
      )
    ).rowCount,
    1,
  );
});
test('avatares reales: revocación durante upload impide activar la foto nueva', async () => {
  const f = await fixture();
  const bytes = await image();
  afterPut = async () => {
    assert.equal((await f.call('post', '/auth/logout-all')).status, 204);
  };
  try {
    assert.equal(
      (
        await f.call('put', '/users/me/avatar').attach('file', bytes, {
          filename: 'a.png',
          contentType: 'image/png',
        })
      ).status,
      401,
    );
  } finally {
    afterPut = undefined;
  }
  assert.equal(
    (
      await pool.query('SELECT avatar_key FROM fcmatch.users WHERE id=$1', [
        f.user.id,
      ])
    ).rows[0].avatar_key,
    null,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT 1 FROM fcmatch.avatar_objects WHERE user_id=$1',
        [f.user.id],
      )
    ).rowCount,
    0,
  );
});
test('CSRF real: el cookie jar envía contexto a /users y mantiene refresh restringido a /auth', async () => {
  const f = await fixture();
  const agent = request.agent(app);
  const bootstrap = await agent
    .get('/api/v1/auth/csrf')
    .set('Origin', identity.webOrigin);
  const login = await agent
    .post('/api/v1/auth/login')
    .set('Origin', identity.webOrigin)
    .set('X-CSRF-Token', bootstrap.body.csrfToken)
    .send({ email: f.user.email, password });
  assert.equal(login.status, 200);
  const edit = await agent
    .patch('/api/v1/users/me')
    .set('Origin', identity.webOrigin)
    .set('X-CSRF-Token', login.body.csrfToken)
    .set('Authorization', `Bearer ${login.body.accessToken}`)
    .send({ leagueName: 'Cookie jar real' });
  assert.equal(edit.status, 200);
});

test('avatares reales: publicación tardía tras reserva vencida reconstruye compensación', async () => {
  const f = await fixture();
  const bytes = await image();
  let lateUrl = '';
  afterPut = async () => {
    const row = (
      await pool.query(
        "SELECT object_key FROM fcmatch.avatar_objects WHERE user_id=$1 AND state='reserved'",
        [f.user.id],
      )
    ).rows[0];
    await pool.query(
      "UPDATE fcmatch.avatar_objects SET created_at=clock_timestamp()-interval '16 minutes' WHERE object_key=$1",
      [row.object_key],
    );
    await profiles.cleanup(f.user.id);
    await real.put(row.object_key, bytes, 'image/png');
    lateUrl = (await real.sign(row.object_key)).url;
  };
  try {
    assert.equal(
      (
        await f.call('put', '/users/me/avatar').attach('file', bytes, {
          filename: 'late.png',
          contentType: 'image/png',
        })
      ).status,
      503,
    );
  } finally {
    afterPut = undefined;
  }
  assert.equal((await fetch(lateUrl)).status, 404);
  assert.equal(
    (
      await pool.query(
        'SELECT 1 FROM fcmatch.avatar_objects WHERE user_id=$1',
        [f.user.id],
      )
    ).rowCount,
    0,
  );
});

for (const mode of ['reject', 'ambiguous'] as const)
  test(`correo real: SMTP ${mode} conserva token y correo anterior`, async () => {
    const f = await fixture();
    const email = destination();
    smtpMode = mode;
    try {
      assert.equal(
        (
          await f.call('post', '/users/me/email-change', {
            newEmail: email,
            currentPassword: password,
          })
        ).status,
        202,
      );
    } finally {
      smtpMode = 'accept';
    }
    const value = token();
    assert.equal((await f.call('get', '/users/me')).body.email, f.user.email);
    assert.equal(
      (await f.call('post', '/users/me/email-change/confirm', { token: value }))
        .status,
      200,
    );
  });
