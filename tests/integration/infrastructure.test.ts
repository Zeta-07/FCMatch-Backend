import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { runner } from 'node-pg-migrate';
import { SMTPServer } from 'smtp-server';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/shared/config/env.js';
import { createPool } from '../../src/shared/db/pool.js';
import { createMailTransport } from '../../src/shared/mail/transport.js';

test('PostgreSQL real: migraciones repetibles, UTC y health', async () => {
  const config = loadConfig();
  assert.ok(
    config.TEST_DATABASE_URL,
    'Configura TEST_DATABASE_URL para la base aislada de pruebas.',
  );
  assert.notEqual(
    config.DATABASE_URL,
    config.TEST_DATABASE_URL,
    'No uses la base de desarrollo para pruebas.',
  );
  const options = {
    databaseUrl: config.TEST_DATABASE_URL,
    dir: 'migrations',
    direction: 'up' as const,
    migrationsTable: 'schema_migrations',
    log: () => {},
  };
  await runner(options);
  const repeated = await runner(options);
  assert.equal(repeated.length, 0);
  const pool = createPool(config.TEST_DATABASE_URL);
  try {
    const result = await pool.query('SHOW timezone');
    assert.equal(result.rows[0].TimeZone, 'UTC');
    const response = await request(createApp(config, pool))
      .get('/api/v1/health')
      .expect(200);
    assert.equal(response.body.database, 'connected');
    const schema = await pool.query(
      'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
      ['fcmatch'],
    );
    assert.equal(schema.rowCount, 1);
  } finally {
    await pool.end();
  }
});

test('SMTP local recibe un mensaje técnico real sin servicio externo', async () => {
  let received = false;
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, _session, callback) {
      stream.on('data', () => {});
      stream.on('end', () => {
        received = true;
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.server.address();
  assert.ok(address && typeof address === 'object');
  const transport = createMailTransport({
    ...loadConfig(),
    SMTP_PORT: address.port,
  });
  try {
    await transport.verify();
    await transport.sendMail({
      from: 'infra@fcmatch.test',
      to: 'pruebas@fcmatch.test',
      subject: 'Verificación de infraestructura',
      text: 'Fase 0',
    });
    assert.equal(received, true);
  } finally {
    transport.close();
    await new Promise<void>((resolve) => server.close(resolve));
  }
});
