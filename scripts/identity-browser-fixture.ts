// Acceptance harness: the actual API and real PostgreSQL/SMTP/S3. No extra HTTP endpoints.
// Start only as a child process with IPC, NODE_ENV=test and the isolated test database.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SMTPServer } from 'smtp-server';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/shared/config/env.js';
import { loadIdentityConfig } from '../src/shared/config/identity.js';
import { createPool } from '../src/shared/db/pool.js';
import { createMailTransport } from '../src/shared/mail/transport.js';
import { createAvatarStorage } from '../src/shared/storage/avatars.js';
import { IdentityRepository } from '../src/modules/users/repository/identity.js';
import { SessionsRepository } from '../src/modules/users/repository/sessions.js';
import { ProfilesRepository } from '../src/modules/users/repository/profiles.js';
import {
  RegistrationService,
  abuseDigest,
} from '../src/modules/users/service/registration.js';
import { SessionsService } from '../src/modules/users/service/sessions.js';
import { ProfilesService } from '../src/modules/users/service/profiles.js';
import { AccessTokens } from '../src/modules/users/service/access-token.js';
import { createPasswordCrypto } from '../src/modules/users/service/password.js';
import { createVerificationDelivery } from '../src/modules/users/service/verification-mail.js';

assert.ok(
  process.send && process.env['NODE_ENV'] === 'test',
  'Solo proceso de pruebas con IPC.',
);
const base = loadConfig();
assert.ok(
  base.TEST_DATABASE_URL &&
    new URL(base.TEST_DATABASE_URL).pathname.endsWith('_test'),
);
assert.notEqual(base.TEST_DATABASE_URL, base.DATABASE_URL);
assert.notEqual(
  new URL(base.TEST_DATABASE_URL).pathname,
  new URL(base.DATABASE_URL).pathname,
);
const prefix = process.env['FCMATCH_E2E_RUN_ID'] ?? '';
assert.match(prefix, /^e2e_[a-f0-9]{20}$/);
const pool = createPool(base.TEST_DATABASE_URL);
await pool.query('SELECT 1');
const emails = new Set<string>();
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['AUTH', 'STARTTLS'],
  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      const text = Buffer.concat(chunks)
        .toString()
        .replace(/=\r?\n/g, '')
        .replace(/=3D/g, '=');
      const match = text.match(
        /\/(verificar-correo|restablecer-contrasena|confirmar-cambio-correo)#token=([A-Za-z0-9_-]{43})/,
      );
      for (const recipient of session.envelope.rcptTo) {
        if (
          recipient.address.startsWith(`${prefix}_`) &&
          recipient.address.endsWith('@fcmatch.test')
        ) {
          emails.add(recipient.address);
          if (match)
            process.send!({
              type: 'mail',
              email: recipient.address,
              path: match[1],
              token: match[2],
            });
        }
      }
      callback();
    });
  },
});
await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
const smtpPort = (smtp.server.address() as { port: number }).port;
const mail = createMailTransport({
  ...base,
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: smtpPort,
  SMTP_SECURE: false,
  SMTP_USER: '',
  SMTP_PASSWORD: '',
});
const config = {
  ...base,
  DATABASE_URL: base.TEST_DATABASE_URL,
  CORS_ORIGINS: ['http://localhost:4300', 'http://localhost:4301'],
};
const identity = loadIdentityConfig(config, {
  IDENTITY_CSRF_SECRET: randomBytes(32).toString('hex'),
  IDENTITY_ABUSE_SECRET: randomBytes(32).toString('hex'),
  IDENTITY_WEB_ORIGIN: 'http://localhost:4300',
  IDENTITY_MOBILE_ORIGIN: 'http://localhost:4301',
  IDENTITY_API_ORIGIN: 'http://localhost:3006',
});
const passwords = await createPasswordCrypto();
const delivery = (purpose: 'verification' | 'reset' | 'email-change') =>
  createVerificationDelivery(
    (message) => mail.sendMail(message),
    config.SMTP_FROM,
    identity.webOrigin,
    () => {},
    purpose,
  );
const registration = new RegistrationService(
  new IdentityRepository(pool),
  passwords.hash,
  delivery('verification'),
  identity.abuseSecret,
);
const sessions = new SessionsService(
  new SessionsRepository(pool),
  passwords,
  new AccessTokens(randomBytes(32).toString('hex'), identity.apiOrigin),
  identity.abuseSecret,
  registration,
  delivery('reset'),
);
const credentials = JSON.parse(
  await readFile('.local/storage/credentials.json', 'utf8'),
) as { test: { accessKey: string; secretKey: string } };
const storage = createAvatarStorage(
  loadConfig({
    ...process.env,
    STORAGE_PROVIDER: 's3-local',
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_BUCKET: 'fcmatch-test-avatars',
    S3_ACCESS_KEY_ID: credentials.test.accessKey,
    S3_SECRET_ACCESS_KEY: credentials.test.secretKey,
  }),
)!;
await storage.verify();
const profiles = new ProfilesService(
  new ProfilesRepository(pool),
  sessions,
  registration,
  storage,
  identity.csrfSecret,
  delivery('email-change'),
);
const server = createApp(config, pool, {
  service: registration,
  config: identity,
  sessions,
  profiles,
}).listen(3006, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
server.requestTimeout = 30000;
process.send!({ type: 'ready' });
let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const users = await pool.query<{ id: string }>(
    'SELECT id FROM fcmatch.users WHERE email=ANY($1::text[])',
    [[...emails]],
  );
  const ids = users.rows.map((row) => row.id);
  for (const id of ids) {
    await pool.query('UPDATE fcmatch.users SET avatar_key=NULL WHERE id=$1', [
      id,
    ]);
    await pool.query(
      "UPDATE fcmatch.avatar_objects SET state='retired' WHERE user_id=$1",
      [id],
    );
    await profiles.cleanup(id);
  }
  await pool.query(
    'DELETE FROM fcmatch.action_tokens WHERE user_id=ANY($1::uuid[])',
    [ids],
  );
  await pool.query(
    'DELETE FROM fcmatch.sessions WHERE user_id=ANY($1::uuid[])',
    [ids],
  );
  await pool.query('DELETE FROM fcmatch.users WHERE id=ANY($1::uuid[])', [ids]);
  const keys = [...emails].flatMap((email) =>
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
  mail.close();
  storage.close();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
  await pool.end();
  if (process.connected) process.send!({ type: 'cleaned', users: ids.length });
  process.disconnect?.();
}
process.on('message', (message: unknown) => {
  if (message === 'stop')
    void cleanup().catch(() => {
      process.exitCode = 1;
      process.disconnect?.();
    });
});
process.on('disconnect', () => {
  if (!closing)
    void cleanup().catch(() => {
      process.exitCode = 1;
    });
});
