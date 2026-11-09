import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/shared/config/env.js';

const config = loadConfig();
const database = {
  query: async () => ({ rows: [{ '?column?': 1 }] }),
} as unknown as Pick<Pool, 'query'>;

test('health devuelve el contrato y cabeceras de seguridad', async () => {
  const response = await request(createApp(config, database))
    .get('/api/v1/health')
    .expect(200);
  assert.deepEqual(response.body, {
    status: 'ok',
    service: 'fcmatch-api',
    database: 'connected',
  });
  assert.ok(response.headers['x-content-type-options']);
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('la caída de PostgreSQL no expone información interna', async () => {
  const failing = {
    query: async () => {
      throw new Error('password=secreto');
    },
  } as unknown as Pick<Pool, 'query'>;
  const response = await request(createApp(config, failing))
    .get('/api/v1/health')
    .expect(503);
  assert.equal(response.body.error.code, 'DATABASE_UNAVAILABLE');
  assert.ok(!JSON.stringify(response.body).includes('secreto'));
});

test('CORS permite solo orígenes propios y mantiene errores uniformes', async () => {
  const app = createApp(config, database);
  const allowed = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'http://localhost:4200')
    .expect(200);
  assert.equal(
    allowed.headers['access-control-allow-origin'],
    'http://localhost:4200',
  );
  const denied = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'https://ajeno.invalid')
    .expect(403);
  assert.equal(denied.body.error.code, 'ORIGIN_NOT_ALLOWED');
  const missing = await request(app).get('/ruta-inexistente').expect(404);
  assert.deepEqual(missing.body.error.details, []);
});

test('rechaza JSON malformado y limita solicitudes', async () => {
  const app = createApp(config, database);
  await request(app)
    .post('/api/v1/health')
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400);
  for (let i = 0; i < 119; i++)
    await request(app).get('/api/v1/health').expect(200);
  const limited = await request(app).get('/api/v1/health').expect(429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
});

test('valida configuración sin revelar sus valores', () => {
  assert.throws(
    () => loadConfig({ ...process.env, DATABASE_URL: 'contraseña-secreta' }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('contraseña-secreta'));
      return true;
    },
  );
});
