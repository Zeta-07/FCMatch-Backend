import { createApp } from './app.js';
import { loadConfig } from './shared/config/env.js';
import { createPool } from './shared/db/pool.js';
import { loadIdentityConfig } from './shared/config/identity.js';
import { IdentityRepository } from './modules/users/repository/identity.js';
import { RegistrationService } from './modules/users/service/registration.js';
import { createPasswordCrypto } from './modules/users/service/password.js';
import { loadSessionSecret } from './shared/config/sessions.js';
import { AccessTokens } from './modules/users/service/access-token.js';
import { SessionsRepository } from './modules/users/repository/sessions.js';
import { SessionsService } from './modules/users/service/sessions.js';
import { createMailTransport } from './shared/mail/transport.js';
import { createVerificationDelivery } from './modules/users/service/verification-mail.js';
import { ProfilesRepository } from './modules/users/repository/profiles.js';
import { ProfilesService } from './modules/users/service/profiles.js';
import { createAvatarStorage } from './shared/storage/avatars.js';

const config = loadConfig();
const identityConfig = loadIdentityConfig(config);
const jwtSecret = loadSessionSecret(identityConfig);
const passwords = await createPasswordCrypto();
const mail = createMailTransport(config);
const database = createPool(config.DATABASE_URL);
database.on('error', () => console.error('Error de conexión con PostgreSQL.'));
await database.query('SELECT 1');
const service = new RegistrationService(
  new IdentityRepository(database),
  passwords.hash,
  createVerificationDelivery(
    (message) => mail.sendMail(message),
    config.SMTP_FROM,
    identityConfig.webOrigin,
  ),
  identityConfig.abuseSecret,
);
const sessions = new SessionsService(
  new SessionsRepository(database),
  passwords,
  new AccessTokens(jwtSecret, identityConfig.apiOrigin),
  identityConfig.abuseSecret,
  service,
  createVerificationDelivery(
    (message) => mail.sendMail(message),
    config.SMTP_FROM,
    identityConfig.webOrigin,
    undefined,
    'reset',
  ),
);
const storage = createAvatarStorage(config);
if (storage) await storage.verify();
const profiles = new ProfilesService(
  new ProfilesRepository(database),
  sessions,
  service,
  storage,
  identityConfig.csrfSecret,
  createVerificationDelivery(
    (message) => mail.sendMail(message),
    config.SMTP_FROM,
    identityConfig.webOrigin,
    undefined,
    'email-change',
  ),
);
const server = createApp(config, database, {
  service,
  config: identityConfig,
  sessions,
  profiles,
}).listen(config.PORT, config.HOST, () => {
  console.info(
    `FCMatch API disponible en http://${config.HOST}:${config.PORT}/api/v1/health`,
  );
});
let closing = false;
server.requestTimeout = 30_000;
function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    mail.close();
    storage?.close();
    void database.end().then(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
