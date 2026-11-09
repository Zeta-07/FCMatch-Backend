import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import process from 'node:process';
import { URL } from 'node:url';

if (!process.env['CI'])
  throw new Error('Este script está reservado al entorno efímero de CI.');
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('Falta DATABASE_URL.');
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await pool.query('CREATE DATABASE fcmatch_test');
} finally {
  await pool.end();
}
const testUrl = new URL(databaseUrl);
testUrl.pathname = '/fcmatch_test';
await writeFile(
  '.env',
  [
    'NODE_ENV=test',
    `DATABASE_URL=${databaseUrl}`,
    `TEST_DATABASE_URL=${testUrl.href}`,
    'CORS_ORIGINS=http://localhost:4200,http://localhost:4300',
    'SMTP_HOST=127.0.0.1',
    'SMTP_PORT=1025',
    'SMTP_FROM=FCMatch <infra@fcmatch.test>',
    '',
  ].join('\n'),
);
