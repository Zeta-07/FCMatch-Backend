import { runner } from 'node-pg-migrate';
import { loadConfig } from '../src/shared/config/env.js';

await runner({
  databaseUrl: loadConfig().DATABASE_URL,
  dir: 'migrations',
  direction: 'up',
  migrationsTable: 'schema_migrations',
  checkOrder: true,
  singleTransaction: true,
});
