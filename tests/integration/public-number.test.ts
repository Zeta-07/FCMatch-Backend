import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool } from '../../src/shared/db/pool.js';
import { loadConfig } from '../../src/shared/config/env.js';

test('migración ID: cuentas existentes, concurrencia, permanencia, límites y UUID intactos', async () => {
  const config = loadConfig();
  assert.ok(config.TEST_DATABASE_URL);
  assert.ok(new URL(config.TEST_DATABASE_URL).pathname.endsWith('_test'));
  assert.notEqual(config.TEST_DATABASE_URL, config.DATABASE_URL);
  const pool = createPool(config.TEST_DATABASE_URL);
  const client = await pool.connect();
  const schema = `number_test_${randomUUID().replaceAll('-', '')}`;
  const source = async (name: string) =>
    (
      await readFile(
        new URL(`../../migrations/${name}`, import.meta.url),
        'utf8',
      )
    )
      .split('-- Down Migration')[0]!
      .replaceAll('fcmatch.', `${schema}.`);
  const hash =
    '$argon2id$v=19$m=65536,t=3,p=1$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(await source('1794355200000_identity.sql'));
    const previous = (
      await client.query(
        `INSERT INTO ${schema}.users (username,email,password_hash)
      VALUES ('old_user','old@fcmatch.test',$1) RETURNING id,public_id,created_at`,
        [hash],
      )
    ).rows[0];
    await client.query(await source('1794596400000_public_number_expand.sql'));
    // El código anterior puede insertar durante expand sin conocer la nueva columna.
    await client.query(
      `INSERT INTO ${schema}.users(username,email,password_hash) VALUES ('during','during@fcmatch.test',$1)`,
      [hash],
    );
    await client.query(
      await source('1794596401000_public_number_finalize.sql'),
    );
    const current = (
      await client.query(
        `SELECT id,public_id,created_at,public_number FROM ${schema}.users WHERE id=$1`,
        [previous.id],
      )
    ).rows[0];
    assert.equal(current.id, previous.id);
    assert.equal(current.public_id, previous.public_id);
    assert.deepEqual(current.created_at, previous.created_at);
    assert.match(String(current.public_number), /^[1-9][0-9]{7}$/);
    // Repetir el backfill no reasigna cuentas ya migradas.
    assert.equal(
      (
        await client.query(
          `UPDATE ${schema}.users SET public_number=nextval('${schema}.users_public_number_seq') WHERE public_number IS NULL`,
        )
      ).rowCount,
      0,
    );
    for (const value of [null, 9999999, 100000000, current.public_number + 1]) {
      await client.query('SAVEPOINT invalid');
      await assert.rejects(
        client.query(
          `UPDATE ${schema}.users SET public_number=$1 WHERE id=$2`,
          [value, current.id],
        ),
        { code: '23514' },
      );
      await client.query('ROLLBACK TO SAVEPOINT invalid');
    }
    await client.query('SAVEPOINT duplicate');
    await assert.rejects(
      client.query(
        `INSERT INTO ${schema}.users(username,email,password_hash,public_number) VALUES ('dup','dup@fcmatch.test',$1,$2)`,
        [hash, current.public_number],
      ),
      { code: '23505' },
    );
    await client.query('ROLLBACK TO SAVEPOINT duplicate');
    await client.query('COMMIT');
    const rows = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        pool.query(
          `INSERT INTO ${schema}.users(username,email,password_hash) VALUES ($1,$2,$3) RETURNING public_number`,
          [`parallel_${i}`, `parallel_${i}@fcmatch.test`, hash],
        ),
      ),
    );
    assert.equal(new Set(rows.map((r) => r.rows[0].public_number)).size, 12);
    const deleted = rows[0]!.rows[0].public_number;
    await client.query(`DELETE FROM ${schema}.users WHERE public_number=$1`, [
      deleted,
    ]);
    const next = (
      await client.query(
        `INSERT INTO ${schema}.users(username,email,password_hash) VALUES ('after_delete','after@fcmatch.test',$1) RETURNING public_number`,
        [hash],
      )
    ).rows[0].public_number;
    assert.ok(next > deleted);
    // Se agota SOLO la secuencia del esquema sintético, nunca la de la aplicación.
    await client.query(
      `SELECT setval('${schema}.users_public_number_seq',99999999,true)`,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO ${schema}.users(username,email,password_hash) VALUES ('exhausted','exhausted@fcmatch.test',$1)`,
        [hash],
      ),
      { code: '2200H' },
    );
  } finally {
    await client.query('ROLLBACK');
    // Esquema generado por esta prueba, no datos de usuario ni esquema compartido.
    await client.query(
      `DROP TABLE IF EXISTS ${schema}.login_attempts, ${schema}.action_tokens, ${schema}.sessions, ${schema}.users`,
    );
    await client.query(
      `DROP FUNCTION IF EXISTS ${schema}.public_number_guard_update(), ${schema}.identity_guard_update(), ${schema}.identity_guard_session_insert()`,
    );
    await client.query(`DROP SCHEMA IF EXISTS ${schema}`);
    client.release();
    await pool.end();
  }
});
