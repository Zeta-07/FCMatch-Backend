import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, decodeJwt } from 'jose';
import {
  AccessTokens,
  type BrowserContext,
} from '../src/modules/users/service/access-token.js';
import { parseDto } from '../src/modules/users/dto/registration.js';
import {
  loginSchema,
  resetSchema,
  changePasswordSchema,
  emptySchema,
} from '../src/modules/users/dto/sessions.js';
import { createPasswordCrypto } from '../src/modules/users/service/password.js';
import { loadSessionSecret } from '../src/shared/config/sessions.js';
import type { IdentityConfig } from '../src/shared/config/identity.js';

const secret = randomBytes(32).toString('hex');
const context: BrowserContext = {
  origin: 'http://localhost:4200',
  client: 'web',
  csrfFamily: randomUUID(),
};
test('sesiones DTO: strict, Unicode, sin refresh en JSON ni destinos arbitrarios', () => {
  assert.equal(
    parseDto(loginSchema, { email: ' A@FCMATCH.test ', password: '🏆' }).email,
    'a@fcmatch.test',
  );
  for (const body of [{ refreshToken: 'x'.repeat(43) }, { role: 'admin' }])
    assert.throws(() => parseDto(emptySchema, body), { status: 422 });
  assert.throws(
    () =>
      parseDto(loginSchema, { email: 'a@fcmatch.test', password: '\ud800' }),
    { status: 422 },
  );
  assert.throws(
    () =>
      parseDto(resetSchema, { token: 'a'.repeat(43), newPassword: 'corta' }),
    { status: 422 },
  );
  assert.throws(
    () =>
      parseDto(changePasswordSchema, {
        currentPassword: 'actual',
        newPassword: 'a'.repeat(12),
        email: 'otro@fcmatch.test',
      }),
    { status: 422 },
  );
});
test('JWT: firma, algoritmo, issuer, audiencia, origen, expiración y vida máxima', async () => {
  const now = Date.now();
  const tokens = new AccessTokens(secret, 'fcmatch-test', () => now);
  const user = randomUUID();
  const result = await tokens.issue(
    user,
    context.csrfFamily,
    new Date(now + 3_600_000),
    context,
  );
  assert.equal(result.expiresIn, 900);
  const claims = await tokens.verify(result.accessToken, context);
  assert.equal(claims.userId, user);
  assert.equal(claims.family, context.csrfFamily);
  await assert.rejects(tokens.verify(result.accessToken + 'x', context), {
    status: 401,
  });
  await assert.rejects(
    tokens.verify(result.accessToken, {
      ...context,
      origin: 'http://localhost:8100',
      client: 'mobile_browser',
    }),
    { status: 401 },
  );
  await assert.rejects(
    new AccessTokens(secret, 'issuer-distinto', () => now).verify(
      result.accessToken,
      context,
    ),
    { status: 401 },
  );
  await assert.rejects(
    new AccessTokens(
      randomBytes(32).toString('hex'),
      'fcmatch-test',
      () => now,
    ).verify(result.accessToken, context),
    { status: 401 },
  );
  await assert.rejects(
    new AccessTokens(secret, 'fcmatch-test', () => now + 901_000).verify(
      result.accessToken,
      context,
    ),
    { status: 401 },
  );
  const payload = decodeJwt(result.accessToken);
  const weak = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS384', typ: 'JWT' })
    .sign(Buffer.from(secret, 'hex'));
  await assert.rejects(tokens.verify(weak, context), { status: 401 });
  const long = await new SignJWT({ ...payload, exp: Number(payload.iat) + 901 })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(Buffer.from(secret, 'hex'));
  await assert.rejects(tokens.verify(long, context), { status: 401 });
  const none =
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    ) +
    '.' +
    Buffer.from(JSON.stringify(payload)).toString('base64url') +
    '.';
  await assert.rejects(tokens.verify(none, context), { status: 401 });
});
test('JWT: no extiende vencimiento absoluto de familia ni emite para sesión vencida', async () => {
  const now = Date.now();
  const tokens = new AccessTokens(secret, 'fcmatch-test', () => now);
  const result = await tokens.issue(
    randomUUID(),
    randomUUID(),
    new Date(now + 20_000),
    context,
  );
  assert.ok(result.expiresIn <= 20 && result.expiresIn >= 19);
  await assert.rejects(
    tokens.issue(randomUUID(), randomUUID(), new Date(now - 1000), context),
    { status: 401 },
  );
});
test('JWT config: sin defaults ni secretos compartidos con CSRF/abuso', () => {
  const identity = {
    csrfSecret: randomBytes(32).toString('hex'),
    abuseSecret: randomBytes(32).toString('hex'),
  } as IdentityConfig;
  for (const key of [
    undefined,
    'valor-inseguro',
    identity.csrfSecret,
    identity.abuseSecret,
  ])
    assert.throws(
      () => loadSessionSecret(identity, { IDENTITY_JWT_SECRET: key }),
      /Configuración JWT/,
    );
  assert.equal(
    loadSessionSecret(identity, { IDENTITY_JWT_SECRET: secret }),
    secret,
  );
});
test('Argon2: verificación ficticia, exactitud y límite compartido hash/verificación', async () => {
  const passwords = await createPasswordCrypto();
  assert.equal(
    await passwords.verify(undefined, 'Contraseña sintética'),
    false,
  );
  const hash = await passwords.hash('Contraseña sintética');
  assert.equal(await passwords.verify(hash, 'Contraseña sintética'), true);
  const results = await Promise.allSettled([
    passwords.verify(hash, 'incorrecta'),
    passwords.hash('Otra contraseña'),
    passwords.verify(undefined, 'incorrecta'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  const rejected = results.find((r) => r.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && rejected.reason.status === 503);
});
