import { createApp } from './app.js';
import { loadConfig } from './shared/config/env.js';
import { createPool } from './shared/db/pool.js';

const config = loadConfig();
const database = createPool(config.DATABASE_URL);
database.on('error', () => console.error('Error de conexión con PostgreSQL.'));
await database.query('SELECT 1');
const server = createApp(config, database).listen(
  config.PORT,
  config.HOST,
  () => {
    console.info(
      `FCMatch API disponible en http://${config.HOST}:${config.PORT}/api/v1/health`,
    );
  },
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    void database.end().then(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
