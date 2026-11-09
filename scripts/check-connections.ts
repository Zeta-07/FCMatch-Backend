import { loadConfig } from '../src/shared/config/env.js';
import { createPool } from '../src/shared/db/pool.js';
import { createMailTransport } from '../src/shared/mail/transport.js';
import { createStorage } from '../src/shared/storage/r2.js';

const config = loadConfig();
const database = createPool(config.DATABASE_URL);
const mail = createMailTransport(config);
try {
  await database.query('SELECT 1');
  console.info('PostgreSQL: conexión verificada.');
  await mail.verify();
  console.info('SMTP: conexión verificada.');
  const storage = createStorage(config);
  if (storage) {
    try {
      await storage.verify();
      console.info(
        'R2: acceso al bucket verificado; revisar privacidad en Cloudflare.',
      );
    } finally {
      storage.client.destroy();
    }
  } else
    console.info(
      'R2: PENDIENTE de credenciales; no se ha comprobado la conexión.',
    );
} catch {
  console.error(
    'Falló una conexión de infraestructura. Revisa configuración y servicios locales.',
  );
  process.exitCode = 1;
} finally {
  await database.end();
  mail.close();
}
