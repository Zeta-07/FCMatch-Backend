import { createApp } from './app.js';
import { loadConfig } from './shared/config/env.js';
import { createPool } from './shared/db/pool.js';
import { loadIdentityConfig } from './shared/config/identity.js';
import { IdentityRepository } from './modules/users/repository/identity.js';
import { RegistrationService } from './modules/users/service/registration.js';
import { createPasswordHasher } from './modules/users/service/password.js';
import { createMailTransport } from './shared/mail/transport.js';
import { createVerificationDelivery } from './modules/users/service/verification-mail.js';

const config = loadConfig();
const identityConfig = loadIdentityConfig(config);
const mail = createMailTransport(config);
const database = createPool(config.DATABASE_URL);
database.on('error', () => console.error('Error de conexión con PostgreSQL.'));
await database.query('SELECT 1');
const service = new RegistrationService(
  new IdentityRepository(database),
  createPasswordHasher(),
  createVerificationDelivery(
    (message) => mail.sendMail(message),
    config.SMTP_FROM,
    identityConfig.webOrigin,
  ),
  identityConfig.abuseSecret,
);
const server = createApp(config, database, {
  service,
  config: identityConfig,
}).listen(config.PORT, config.HOST, () => {
  console.info(
    `FCMatch API disponible en http://${config.HOST}:${config.PORT}/api/v1/health`,
  );
});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    mail.close();
    void database.end().then(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
