import { runner } from 'node-pg-migrate';
import { loadConfig } from '../src/shared/config/env.js';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--public-number-expand'))
  throw new Error('Opción de migración no admitida.');
await runner({
  databaseUrl: loadConfig().DATABASE_URL,
  dir: 'migrations',
  direction: 'up',
  migrationsTable: 'schema_migrations',
  checkOrder: true,
  singleTransaction: true,
  ...(args.includes('--public-number-expand')
    ? { timestamp: true, count: 1794596400000 }
    : {}),
});
