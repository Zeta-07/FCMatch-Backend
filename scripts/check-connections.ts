import { loadConfig } from '../src/shared/config/env.js';
import { createPool } from '../src/shared/db/pool.js';
import { createMailTransport } from '../src/shared/mail/transport.js';
import { createAvatarStorage } from '../src/shared/storage/avatars.js';

const config = loadConfig();
const database = createPool(config.DATABASE_URL);
const mail = createMailTransport(config);
try {
  await database.query('SELECT 1');
  console.info('PostgreSQL: conexión verificada.');
  await mail.verify();
  console.info('SMTP: conexión verificada.');
  const storage = createAvatarStorage(config);
  if (storage) {
    try {
      await storage.verify();
      console.info(
        config.STORAGE_PROVIDER === 's3-local'
          ? 'S3 local: bucket accesible; privacidad comprobada por las pruebas de integración. R2 real pendiente.'
          : 'R2: acceso al bucket verificado; revisar privacidad en Cloudflare.',
      );
    } finally {
      storage.close();
    }
  } else
    console.info(
      'Almacenamiento deshabilitado; no se ha comprobado la conexión. R2 real pendiente.',
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
