import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { verify } from 'argon2';
import request from 'supertest';
import type { Pool } from 'pg';
import { createPasswordHasher } from '../src/modules/users/service/password.js';
import {
  parseDto,
  registrationSchema,
  verificationSchema,
} from '../src/modules/users/dto/registration.js';
import { createVerificationDelivery } from '../src/modules/users/service/verification-mail.js';
import {
  abuseDigest,
  RegistrationService,
  tokenDigest,
} from '../src/modules/users/service/registration.js';
import { IdentityRepository } from '../src/modules/users/repository/identity.js';
import { loadConfig } from '../src/shared/config/env.js';
import { loadIdentityConfig } from '../src/shared/config/identity.js';
import { createApp } from '../src/app.js';
import { createBrowserCsrf } from '../src/shared/middleware/browser-csrf.js';
import express from 'express';
import { errorHandler } from '../src/shared/middleware/errors.js';

const base = loadConfig();
const source = {
  IDENTITY_CSRF_SECRET: randomBytes(32).toString('hex'),
  IDENTITY_ABUSE_SECRET: randomBytes(32).toString('hex'),
  IDENTITY_WEB_ORIGIN: 'http://localhost:4200',
  IDENTITY_MOBILE_ORIGIN: 'http://localhost:8100',
  IDENTITY_API_ORIGIN: 'http://localhost:3000',
};
const config = loadIdentityConfig(
  { ...base, CORS_ORIGINS: ['http://localhost:4200', 'http://localhost:8100'] },
  source,
);
const input = {
  email: 'jugador@fcmatch.test',
  username: 'Jugador',
  password: '  Frase sintética 🏆  ',
};

test('registro DTO: normaliza solo correo, preserva contraseña Unicode y username', () => {
  const actual = parseDto(registrationSchema, {
    ...input,
    email: ' JUGADOR@fcmatch.test ',
  });
  assert.deepEqual(actual, input);
  for (const password of ['🏆'.repeat(12), ' '.repeat(12), 'a'.repeat(128)])
    assert.equal(
      parseDto(registrationSchema, { ...input, password }).password,
      password,
    );
});
test('registro DTO: rechaza extras, privilegios, Unicode inválido y longitudes', () => {
  for (const change of [
    { role: 'admin' },
    { publicId: randomBytes(16).toString('hex') },
    { email: 'no' },
    { username: 'ab' },
    { username: 'nombre ajeno' },
    { password: '🏆'.repeat(11) },
    { password: 'a'.repeat(129) },
    { password: '\ud800'.repeat(12) },
  ]) {
    assert.throws(() => parseDto(registrationSchema, { ...input, ...change }), {
      status: 422,
    });
  }
  assert.throws(() => parseDto(verificationSchema, { token: 'x'.repeat(42) }), {
    status: 422,
  });
});
test('Argon2id real: salts distintos, PHC adecuado, exactitud sin trim y contraseña incorrecta', async () => {
  const hash = createPasswordHasher();
  const a = await hash(input.password);
  const b = await hash(input.password);
  assert.notEqual(a, b);
  assert.match(a, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await verify(a, input.password), true);
  assert.equal(await verify(a, input.password.trim()), false);
  assert.equal(await verify(a, 'Una contraseña distinta'), false);
});
test('Argon2id: límite de concurrencia sin cola y liberación tras error', async () => {
  let release!: (value: string) => void;
  const hasher = createPasswordHasher(
    1,
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const first = hasher('primera');
  await assert.rejects(hasher('segunda'), { status: 503 });
  release('hash');
  assert.equal(await first, 'hash');
  const another = hasher('tercera');
  release('otro');
  assert.equal(await another, 'otro');
  const failing = createPasswordHasher(1, async () => {
    throw new Error('fallo');
  });
  await assert.rejects(failing('uno'));
  await assert.rejects(failing('dos'), /fallo/);
});
test('tokens: SHA256 y HMAC con separación de dominio sin identidad en claro', () => {
  const token = randomBytes(32).toString('base64url');
  assert.equal(token.length, 43);
  assert.equal(tokenDigest(token).length, 32);
  assert.notDeepEqual(tokenDigest(token), tokenDigest(`${token}x`));
  assert.notDeepEqual(
    abuseDigest(source.IDENTITY_ABUSE_SECRET, 'email_ip', input.email),
    abuseDigest(source.IDENTITY_ABUSE_SECRET, 'email_identity', input.email),
  );
});
test('SMTP: fallo genérico sin correo/token/error y sin reintento', async () => {
  const logs: string[] = [];
  let calls = 0;
  const send = createVerificationDelivery(
    async () => {
      calls++;
      throw new Error('credenciales-secretas');
    },
    'no-reply@fcmatch.test',
    config.webOrigin,
    (...parts) => logs.push(parts.join(' ')),
  );
  await send({ email: input.email, token: 'secreto-no-publicable' });
  assert.equal(calls, 1);
  assert.equal(logs.length, 1);
  assert.ok(!logs[0]!.includes(input.email));
  assert.ok(!/credenciales|secreto-no-publicable/.test(logs[0]!));
});
test('SMTP: enlace solo en fragmento y sin acción GET', async () => {
  const token = randomBytes(32).toString('base64url');
  let text = '';
  const send = createVerificationDelivery(
    async (mail) => {
      text = mail.text;
    },
    'no-reply@fcmatch.test',
    config.webOrigin,
  );
  await send({ email: input.email, token });
  const url = new URL(text.match(/http[^\s]+/)![0]);
  assert.equal(url.search, '');
  assert.equal(url.hash, `#token=${token}`);
  assert.equal(url.pathname, '/verificar-correo');
});
test('config identidad: secretos independientes, orígenes exactos, sin filtrar valores inválidos', () => {
  for (const changes of [
    { IDENTITY_CSRF_SECRET: 'secretoprivado' },
    { IDENTITY_WEB_ORIGIN: 'https://ajeno.invalid' },
    { IDENTITY_WEB_ORIGIN: source.IDENTITY_MOBILE_ORIGIN },
    { IDENTITY_CSRF_SECRET: source.IDENTITY_ABUSE_SECRET },
  ]) {
    assert.throws(
      () => loadIdentityConfig(base, { ...source, ...changes }),
      (error) =>
        error instanceof Error && !error.message.includes('secretoprivado'),
    );
  }
  assert.throws(() =>
    loadIdentityConfig({ ...base, NODE_ENV: 'production' }, source),
  );
  assert.throws(() =>
    loadIdentityConfig(
      {
        ...base,
        NODE_ENV: 'production',
        CORS_ORIGINS: ['https://app.example.test', 'https://mobile.other.test'],
      },
      {
        ...source,
        IDENTITY_WEB_ORIGIN: 'https://app.example.test',
        IDENTITY_MOBILE_ORIGIN: 'https://mobile.other.test',
        IDENTITY_API_ORIGIN: 'https://app.example.test',
      },
    ),
  );
});
test('CSRF: contexto reutilizable, aislamiento de clientes, firma, expiración y same-origin explícito', async () => {
  let now = Date.now();
  const csrf = createBrowserCsrf(
    { ...config, apiOrigin: config.webOrigin },
    () => now,
  );
  const app = express();
  app.get('/csrf', csrf.bootstrap);
  app.post('/check', (req, res) => {
    csrf.verify(req);
    res.sendStatus(204);
  });
  app.use(errorHandler);
  const first = await request(app)
    .get('/csrf')
    .set('Origin', config.webOrigin)
    .expect(200);
  const cookie = (first.headers['set-cookie'] as unknown as string[])
    .at(-1)!
    .split(';')[0]!;
  assert.match(
    (first.headers['set-cookie'] as unknown as string[]).at(-1)!,
    /HttpOnly; SameSite=Strict/,
  );
  const second = await request(app)
    .get('/csrf')
    .set('Origin', config.webOrigin)
    .set('Cookie', cookie)
    .expect(200);
  assert.deepEqual(first.body, second.body);
  assert.equal(second.headers['set-cookie'], undefined);
  await request(app)
    .post('/check')
    .set('Origin', config.webOrigin)
    .set('Cookie', cookie)
    .set('X-CSRF-Token', first.body.csrfToken)
    .expect(204);
  await request(app)
    .post('/check')
    .set('Origin', config.mobileOrigin)
    .set('Cookie', cookie)
    .set('X-CSRF-Token', first.body.csrfToken)
    .expect(403);
  await request(app)
    .post('/check')
    .set('Origin', config.webOrigin)
    .set('Cookie', `${cookie}; ${cookie}`)
    .set('X-CSRF-Token', first.body.csrfToken)
    .expect(403);
  await request(app)
    .post('/check')
    .set('Origin', config.webOrigin)
    .set('Cookie', cookie)
    .set('X-CSRF-Token', 'x'.repeat(43))
    .expect(403);
  await request(app)
    .post('/check')
    .set('Origin', config.webOrigin)
    .set('Cookie', cookie.slice(0, -2) + 'xx')
    .set('X-CSRF-Token', first.body.csrfToken)
    .expect(403);
  await request(app).get('/csrf').expect(403);
  await request(app)
    .get('/csrf')
    .set('Sec-Fetch-Site', 'same-origin')
    .expect(200);
  now += 3_600_001;
  await request(app)
    .post('/check')
    .set('Origin', config.webOrigin)
    .set('Cookie', cookie)
    .set('X-CSRF-Token', first.body.csrfToken)
    .expect(403);
});
test('registro HTTP: Origin/CSRF/DTO/tamaño/MIME antes de efectos y sin login', async () => {
  let queries = 0;
  const pool = {
    query: async () => {
      queries++;
      throw new Error('no debe consultar');
    },
    connect: async () => {
      queries++;
      throw new Error('no debe conectar');
    },
  } as unknown as Pool;
  const service = new RegistrationService(
    new IdentityRepository(pool),
    createPasswordHasher(),
    async () => {},
    config.abuseSecret,
  );
  const app = createApp(base, pool, { service, config });
  for (const path of ['/register', '/verify-email', '/resend-verification'])
    await request(app).post(`/api/v1/auth${path}`).send(input).expect(403);
  const proof = await request(app)
    .get('/api/v1/auth/csrf')
    .set('Origin', config.webOrigin)
    .expect(200);
  const cookie = (proof.headers['set-cookie'] as unknown as string[])
    .at(-1)!
    .split(';')[0]!;
  const post = () =>
    request(app)
      .post('/api/v1/auth/register')
      .set('Origin', config.webOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', proof.body.csrfToken);
  await post()
    .send({ ...input, role: 'admin' })
    .expect(422);
  await post().set('Content-Type', 'text/plain').send('texto').expect(415);
  await post()
    .send({ ...input, password: 'x'.repeat(9000) })
    .expect(413);
  await post().set('Content-Type', 'application/json').send('{').expect(400);
  await request(app).get('/api/v1/auth/verify-email').expect(404);
  await request(app).post('/api/v1/auth/login').expect(404);
  await request(app).post('/api/v1/auth/refresh').expect(404);
  assert.equal(queries, 0);
  const rateLimitedApp = createApp(base, pool, { service, config });
  for (let i = 0; i < 30; i++)
    await request(rateLimitedApp).post('/api/v1/auth/verify-email').expect(403);
  const limited = await request(rateLimitedApp)
    .post('/api/v1/auth/verify-email')
    .expect(429);
  assert.ok(limited.headers['retry-after']);
});

test('registro: caída de PostgreSQL antes de persistir no calcula contraseña ni envía correo', async () => {
  let effects = 0;
  const pool = {
    connect: async () => {
      throw new Error('postgresql://secreto-no-publicable');
    },
  } as unknown as Pool;
  const service = new RegistrationService(
    new IdentityRepository(pool),
    async () => {
      effects++;
      return 'no';
    },
    async () => {
      effects++;
    },
    config.abuseSecret,
  );
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
  assert.equal(effects, 0);
});

test('CSRF: cookie Secure en HTTPS y rechazo de Host arbitrario en bootstrap sin Origin', async () => {
  const csrf = createBrowserCsrf({ ...config, secureCookies: true });
  const app = express();
  app.get('/csrf', csrf.bootstrap);
  app.use(errorHandler);
  const response = await request(app)
    .get('/csrf')
    .set('Origin', config.webOrigin)
    .expect(200);
  assert.match(
    (response.headers['set-cookie'] as unknown as string[]).at(-1)!,
    /Secure/,
  );
  await request(app)
    .get('/csrf')
    .set('Host', 'localhost:4200')
    .set('Sec-Fetch-Site', 'same-origin')
    .expect(403);
});
