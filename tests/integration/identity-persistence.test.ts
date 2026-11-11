import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { loadConfig } from '../../src/shared/config/env.js';
import { createPool } from '../../src/shared/db/pool.js';

type Sql = pg.Pool | pg.PoolClient;
type User = { id: string; public_id: string; username: string; email: string };
type Session = { id: string; user_id: string; expires_at: Date };
let pool: pg.Pool;
const tables = ['action_tokens', 'login_attempts', 'sessions', 'users'];
// PHC sintético para probar forma de almacenamiento, no un hash de login utilizable.
const phc =
  '$argon2id$v=19$m=65536,t=3,p=1$Zml4dHVyZS1zYWx0LW9ubHk$' +
  createHash('sha256')
    .update('fixture-not-a-login-password')
    .digest('base64')
    .replace(/=+$/, '');
const digest = () => createHash('sha256').update(randomUUID()).digest();

before(async () => {
  const config = loadConfig();
  assert.ok(config.TEST_DATABASE_URL, 'Falta base aislada de pruebas.');
  const target = new URL(config.TEST_DATABASE_URL);
  const development = new URL(config.DATABASE_URL);
  assert.ok(
    target.pathname.endsWith('_test'),
    'Usa una base terminada en _test.',
  );
  assert.notEqual(
    target.pathname,
    development.pathname,
    'No ejecutar fixtures en desarrollo.',
  );
  await runner({
    databaseUrl: config.TEST_DATABASE_URL,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'schema_migrations',
    advisoryLockMode: 'wait',
    singleTransaction: true,
    checkOrder: true,
    log: () => {},
  });
  pool = createPool(config.TEST_DATABASE_URL);
});

after(async () => {
  if (pool) await pool.end();
});

async function transaction(check: (client: pg.PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await check(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function rejectsSql(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
) {
  await client.query('SAVEPOINT expected_rejection');
  await assert.rejects(
    action,
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code,
  );
  await client.query('ROLLBACK TO SAVEPOINT expected_rejection');
  await client.query('RELEASE SAVEPOINT expected_rejection');
}

async function insertUser(
  db: Sql,
  values: Partial<{
    username: string;
    email: string;
    passwordHash: string;
    publicId: string;
    leagueName: string;
    avatarKey: string;
  }> = {},
): Promise<User> {
  const seed = randomUUID().replaceAll('-', '');
  const result = await db.query<User>(
    `INSERT INTO fcmatch.users (username, email, password_hash, public_id, league_name, avatar_key)
     VALUES ($1, $2, $3, coalesce($4::uuid, gen_random_uuid()), $5, $6)
     RETURNING id, public_id, username, email`,
    [
      values.username ?? `u_${seed.slice(0, 24)}`,
      values.email ?? `${seed}@fcmatch.test`,
      values.passwordHash ?? phc,
      values.publicId ?? null,
      values.leagueName ?? null,
      values.avatarKey ?? null,
    ],
  );
  return result.rows[0]!;
}

async function insertRoot(
  db: Sql,
  userId: string,
  hash = digest(),
  expires = new Date(Date.now() + 3_600_000),
) {
  const id = randomUUID();
  const result = await db.query<Session>(
    `INSERT INTO fcmatch.sessions
       (id, user_id, family_id, refresh_token_hash, client_context, client_origin, device, expires_at)
     VALUES ($1, $2, $1, $3, 'web', 'http://localhost:4200', 'Navegador de prueba', $4)
     RETURNING id, user_id, expires_at`,
    [id, userId, hash, expires],
  );
  return result.rows[0]!;
}

async function insertSuccessor(
  db: Sql,
  root: Session,
  values: Partial<{
    userId: string;
    origin: string;
    expires: Date;
    device: string;
  }> = {},
) {
  return db.query(
    `INSERT INTO fcmatch.sessions
       (user_id, family_id, parent_id, refresh_token_hash, client_context, client_origin, device, expires_at)
     VALUES ($1, $2, $2, $3, 'web', $4, $5, $6) RETURNING id`,
    [
      values.userId ?? root.user_id,
      root.id,
      digest(),
      values.origin ?? 'http://localhost:4200',
      values.device ?? 'Navegador de prueba',
      values.expires ?? root.expires_at,
    ],
  );
}

async function insertAction(
  db: Sql,
  userId: string,
  values: Partial<{
    purpose: string;
    newEmail: string;
    hash: Buffer;
    expires: Date;
  }> = {},
) {
  return db.query<{ id: string }>(
    `INSERT INTO fcmatch.action_tokens (user_id, purpose, token_hash, new_email, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      userId,
      values.purpose ?? 'verify_email',
      values.hash ?? digest(),
      values.newEmail ?? null,
      values.expires ?? new Date(Date.now() + 900_000),
    ],
  );
}

async function removeOwnFixture(userId: string) {
  // Únicamente UUIDs de fixtures de esta ejecución, nunca limpieza global.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM fcmatch.action_tokens WHERE user_id = $1', [
      userId,
    ]);
    await client.query('DELETE FROM fcmatch.sessions WHERE user_id = $1', [
      userId,
    ]);
    await client.query('DELETE FROM fcmatch.users WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

test('identidad BD: cuatro tablas, UUID, timestamptz y migración repetible', async () => {
  const actual = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
    ['fcmatch'],
  );
  assert.deepEqual(
    actual.rows.map((row) => row.table_name),
    tables,
  );
  const columns = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND column_name IN ('id', 'created_at', 'updated_at')`,
    ['fcmatch'],
  );
  assert.equal(columns.rowCount, 12);
  for (const column of columns.rows) {
    assert.equal(
      column.data_type,
      column.column_name === 'id' ? 'uuid' : 'timestamp with time zone',
    );
  }
  const repeated = await runner({
    databaseUrl: loadConfig().TEST_DATABASE_URL!,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'schema_migrations',
    advisoryLockMode: 'wait',
    checkOrder: true,
    log: () => {},
  });
  assert.equal(repeated.length, 0);
});

test('identidad BD: Up/Down/Up en esquema propio transaccional sin tocar datos existentes', async () => {
  const source = await readFile(
    new URL('../../migrations/1794355200000_identity.sql', import.meta.url),
    'utf8',
  );
  const [up, down] = source.split('-- Down Migration');
  assert.ok(up && down);
  const namespace = `identity_test_${randomUUID().replaceAll('-', '')}`;
  // Identificador interno generado, nunca una entrada HTTP; todos los valores usan parámetros.
  assert.match(namespace, /^identity_test_[a-f0-9]{32}$/);
  await transaction(async (client) => {
    await client.query(`CREATE SCHEMA ${namespace}`);
    const apply = (sql: string) =>
      client.query(sql.replaceAll('fcmatch.', `${namespace}.`));
    await apply(up);
    await apply(down);
    const absent = await client.query('SELECT to_regclass($1) AS relation', [
      `${namespace}.users`,
    ]);
    assert.equal(absent.rows[0].relation, null);
    await apply(up);
    const restored = await client.query(
      'SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1',
      [namespace],
    );
    assert.equal(restored.rows[0].count, 4);
  });
  const removed = await pool.query('SELECT to_regnamespace($1) AS namespace', [
    namespace,
  ]);
  assert.equal(removed.rows[0].namespace, null);
});

test('identidad BD: unicidad de username sin mayúsculas, correo y public_id', async () => {
  await transaction(async (client) => {
    const user = await insertUser(client);
    assert.notEqual(user.id, user.public_id);
    await rejectsSql(client, '23505', () =>
      insertUser(client, { username: user.username.toUpperCase() }),
    );
    await rejectsSql(client, '23505', () =>
      insertUser(client, { email: user.email }),
    );
    await rejectsSql(client, '23505', () =>
      insertUser(client, { publicId: user.public_id }),
    );
    await rejectsSql(client, '23514', () =>
      insertUser(client, { email: user.email.toUpperCase() }),
    );
  });
});

test('identidad BD: rechaza perfil inválido, contraseña plana y claves de avatar arbitrarias', async () => {
  await transaction(async (client) => {
    for (const values of [
      { username: 'ab' },
      { username: 'usuario con espacios' },
      { username: 'a'.repeat(31) },
      { email: 'sin-arroba' },
      { email: ' usuario@fcmatch.test' },
      { passwordHash: 'Esto no es un hash de contraseña' },
      { leagueName: '' },
      { leagueName: ' '.repeat(5) },
      { leagueName: 'x'.repeat(101) },
      { avatarKey: '../evidencias/objeto.png' },
      { avatarKey: 'https://ajeno.invalid/foto.png' },
    ])
      await rejectsSql(client, '23514', () => insertUser(client, values));
    await insertUser(client, {
      leagueName: 'Liga de prueba',
      avatarKey: `avatars/${randomUUID().replaceAll('-', '')}.webp`,
    });
  });
});

test('identidad BD: id/public_id/created_at inmutables y updated_at automático', async () => {
  await transaction(async (client) => {
    const user = await insertUser(client);
    await rejectsSql(client, '23514', () =>
      client.query('UPDATE fcmatch.users SET public_id = $1 WHERE id = $2', [
        randomUUID(),
        user.id,
      ]),
    );
    await rejectsSql(client, '23514', () =>
      client.query('UPDATE fcmatch.users SET id = $1 WHERE id = $2', [
        randomUUID(),
        user.id,
      ]),
    );
    await rejectsSql(client, '23514', () =>
      client.query(
        "UPDATE fcmatch.users SET created_at = created_at - interval '1 second' WHERE id = $1",
        [user.id],
      ),
    );
    const changed = await client.query(
      `UPDATE fcmatch.users SET league_name = $1, updated_at = '1970-01-01T00:00:00Z'
       WHERE id = $2 RETURNING updated_at >= created_at AS valid`,
      ['Liga actualizada', user.id],
    );
    assert.equal(changed.rows[0].valid, true);
  });
});

test('identidad BD: FK impiden huérfanos y no borran dependencias implícitamente', async () => {
  await transaction(async (client) => {
    await rejectsSql(client, '23503', () => insertAction(client, randomUUID()));
    await rejectsSql(client, '23503', () => insertRoot(client, randomUUID()));
    const user = await insertUser(client);
    await insertAction(client, user.id);
    await rejectsSql(client, '23503', () =>
      client.query('DELETE FROM fcmatch.users WHERE id = $1', [user.id]),
    );
  });
});

test('identidad BD: sessions conserva hashes, un sucesor y límite absoluto de familia', async () => {
  await transaction(async (client) => {
    const user = await insertUser(client);
    const hash = digest();
    const root = await insertRoot(client, user.id, hash);
    await rejectsSql(client, '23505', () => insertRoot(client, user.id, hash));
    await rejectsSql(client, '23514', () =>
      insertRoot(client, user.id, Buffer.alloc(31)),
    );
    await rejectsSql(client, '23514', () =>
      insertRoot(
        client,
        user.id,
        digest(),
        new Date(Date.now() + 31 * 86_400_000),
      ),
    );
    await rejectsSql(client, '23514', () => insertSuccessor(client, root));
    await client.query(
      'UPDATE fcmatch.sessions SET consumed_at = clock_timestamp() WHERE id = $1',
      [root.id],
    );
    const otherUser = await insertUser(client);
    await rejectsSql(client, '23514', () =>
      insertSuccessor(client, root, { userId: otherUser.id }),
    );
    await rejectsSql(client, '23514', () =>
      insertSuccessor(client, root, { origin: 'http://localhost:8100' }),
    );
    await rejectsSql(client, '23514', () =>
      insertSuccessor(client, root, { device: 'Otro dispositivo' }),
    );
    await rejectsSql(client, '23514', () =>
      insertSuccessor(client, root, {
        expires: new Date(root.expires_at.getTime() + 1_000),
      }),
    );
    await insertSuccessor(client, root);
    await rejectsSql(client, '23505', () => insertSuccessor(client, root));
    const retained = await client.query(
      'SELECT refresh_token_hash, consumed_at FROM fcmatch.sessions WHERE id = $1',
      [root.id],
    );
    assert.deepEqual(retained.rows[0].refresh_token_hash, hash);
    assert.ok(retained.rows[0].consumed_at);
  });
});

test('identidad BD: impide reactivar o reescribir tokens/sesiones consumidos o revocados', async () => {
  await transaction(async (client) => {
    const user = await insertUser(client);
    const root = await insertRoot(client, user.id);
    await client.query(
      'UPDATE fcmatch.sessions SET consumed_at = clock_timestamp(), revoked_at = clock_timestamp() WHERE id = $1',
      [root.id],
    );
    await rejectsSql(client, '23514', () =>
      client.query(
        'UPDATE fcmatch.sessions SET consumed_at = NULL WHERE id = $1',
        [root.id],
      ),
    );
    await rejectsSql(client, '23514', () =>
      client.query(
        'UPDATE fcmatch.sessions SET revoked_at = NULL WHERE id = $1',
        [root.id],
      ),
    );
    await rejectsSql(client, '23514', () =>
      client.query(
        'UPDATE fcmatch.sessions SET refresh_token_hash = $1 WHERE id = $2',
        [digest(), root.id],
      ),
    );
    await rejectsSql(client, '23514', () => insertSuccessor(client, root));
    const action = (await insertAction(client, user.id)).rows[0]!;
    await client.query(
      'UPDATE fcmatch.action_tokens SET used_at = clock_timestamp(), revoked_at = clock_timestamp() WHERE id = $1',
      [action.id],
    );
    await rejectsSql(client, '23514', () =>
      client.query(
        'UPDATE fcmatch.action_tokens SET used_at = NULL WHERE id = $1',
        [action.id],
      ),
    );
    await rejectsSql(client, '23514', () =>
      client.query(
        'UPDATE fcmatch.action_tokens SET revoked_at = NULL WHERE id = $1',
        [action.id],
      ),
    );
    await rejectsSql(client, '23514', () =>
      client.query(
        "UPDATE fcmatch.action_tokens SET expires_at = expires_at + interval '1 minute' WHERE id = $1",
        [action.id],
      ),
    );
  });
});

test('identidad BD: finalidad, hash, destino y vencimiento de action_tokens coherentes', async () => {
  await transaction(async (client) => {
    const user = await insertUser(client);
    const hash = digest();
    await insertAction(client, user.id, { hash });
    await rejectsSql(client, '23505', () =>
      insertAction(client, user.id, { hash }),
    );
    for (const values of [
      { purpose: 'eliminar_cuenta' },
      { hash: Buffer.alloc(43) },
      { purpose: 'email_change' },
      { newEmail: 'nuevo@fcmatch.test' },
      { purpose: 'email_change', newEmail: 'Nuevo@fcmatch.test' },
      { expires: new Date(Date.now() - 60_000) },
      { expires: new Date(Date.now() + 25 * 3_600_000) },
      {
        purpose: 'reset_password',
        expires: new Date(Date.now() + 31 * 60_000),
      },
    ])
      await rejectsSql(client, '23514', () =>
        insertAction(client, user.id, values),
      );
    await insertAction(client, user.id, {
      purpose: 'email_change',
      newEmail: 'nuevo@fcmatch.test',
    });
    await insertAction(client, user.id, { purpose: 'reset_password' });
  });
});

test('identidad BD: contadores sin correo/IP en claro, acotados y con bloqueo temporal finito', async () => {
  await transaction(async (client) => {
    const key = digest();
    const insert = (scope: string, attempts: number, hash: Buffer = key) =>
      client.query(
        `INSERT INTO fcmatch.login_attempts (scope, key_hash, attempts, expires_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP + interval '1 hour') RETURNING id`,
        [scope, hash, attempts],
      );
    const bucket = (await insert('login_identity', 0)).rows[0];
    await rejectsSql(client, '23505', () => insert('login_identity', 1));
    await insert('login_ip', 1);
    await rejectsSql(client, '23514', () => insert('login_ip', -1, digest()));
    await rejectsSql(client, '23514', () => insert('otro', 1));
    await rejectsSql(client, '23514', () =>
      insert('email_identity', 1, Buffer.alloc(31)),
    );
    await rejectsSql(client, '23514', () =>
      client.query(
        "UPDATE fcmatch.login_attempts SET locked_until = 'infinity' WHERE id = $1",
        [bucket.id],
      ),
    );
    await rejectsSql(client, '23514', () =>
      client.query(
        "UPDATE fcmatch.login_attempts SET locked_until = expires_at + interval '1 hour' WHERE id = $1",
        [bucket.id],
      ),
    );
    const names = await client.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      ['fcmatch', 'login_attempts'],
    );
    assert.ok(
      !names.rows.some((row) =>
        ['email', 'ip', 'password', 'token'].includes(row.column_name),
      ),
    );
  });
});

test('identidad BD: índices de búsqueda, FK, pendientes y limpieza disponibles', async () => {
  const result = await pool.query<{ indexname: string; indexdef: string }>(
    'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1',
    ['fcmatch'],
  );
  const indexes = new Map(
    result.rows.map((row) => [row.indexname, row.indexdef]),
  );
  for (const name of [
    'users_public_id_uq',
    'users_email_uq',
    'users_username_ci_uq',
    'sessions_refresh_token_hash_uq',
    'sessions_parent_uq',
    'sessions_user_idx',
    'sessions_family_idx',
    'sessions_expiry_idx',
    'sessions_one_current_per_family_uq',
    'action_tokens_hash_uq',
    'action_tokens_user_purpose_idx',
    'action_tokens_pending_idx',
    'action_tokens_expiry_idx',
    'login_attempts_key_uq',
    'login_attempts_expiry_idx',
  ])
    assert.ok(indexes.has(name), `Falta índice ${name}`);
  assert.match(
    indexes.get('sessions_one_current_per_family_uq')!,
    /WHERE.*consumed_at IS NULL.*revoked_at IS NULL/,
  );
  assert.match(indexes.get('users_username_ci_uq')!, /lower\(username\)/);
});

test('identidad BD: transacción multi-tabla revierte íntegramente sin datos parciales', async () => {
  let id: string;
  await transaction(async (client) => {
    const user = await insertUser(client);
    id = user.id;
    await insertRoot(client, id);
    await insertAction(client, id);
  });
  const retained = await pool.query(
    'SELECT id FROM fcmatch.users WHERE id = $1',
    [id!],
  );
  assert.equal(retained.rowCount, 0);
});

test('identidad BD: altas concurrentes no duplican username por cambios de mayúsculas', async () => {
  const seed = randomUUID().replaceAll('-', '');
  const username = `c_${seed.slice(0, 24)}`;
  const results = await Promise.allSettled([
    insertUser(pool, { username }),
    insertUser(pool, { username: username.toUpperCase() }),
  ]);
  try {
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected');
    assert.ok(failed?.status === 'rejected' && failed.reason.code === '23505');
  } finally {
    for (const result of results)
      if (result.status === 'fulfilled')
        await removeOwnFixture(result.value.id);
  }
});

test('identidad BD: dos sucesores concurrentes conservan solo una rama de refresh', async () => {
  const user = await insertUser(pool);
  try {
    const root = await insertRoot(pool, user.id);
    await pool.query(
      'UPDATE fcmatch.sessions SET consumed_at = clock_timestamp() WHERE id = $1',
      [root.id],
    );
    const results = await Promise.allSettled([
      insertSuccessor(pool, root),
      insertSuccessor(pool, root),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected');
    assert.ok(failed?.status === 'rejected' && failed.reason.code === '23505');
    const count = await pool.query(
      'SELECT count(*)::int AS count FROM fcmatch.sessions WHERE family_id = $1',
      [root.id],
    );
    assert.equal(count.rows[0].count, 2);
  } finally {
    await removeOwnFixture(user.id);
  }
});

test('identidad BD: consumo condicional concurrente del mismo action_token devuelve una sola fila', async () => {
  const user = await insertUser(pool);
  try {
    const action = (await insertAction(pool, user.id)).rows[0]!;
    const consume = () =>
      pool.query(
        `UPDATE fcmatch.action_tokens SET used_at = clock_timestamp()
       WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > clock_timestamp()
       RETURNING id`,
        [action.id],
      );
    const results = await Promise.all([consume(), consume()]);
    assert.equal(
      results.reduce((sum, r) => sum + (r.rowCount ?? 0), 0),
      1,
    );
  } finally {
    await removeOwnFixture(user.id);
  }
});

test('identidad BD: UPSERT concurrente de intentos no pierde incrementos', async () => {
  const key = digest();
  try {
    const increment = () =>
      pool.query(
        `INSERT INTO fcmatch.login_attempts (scope, key_hash, attempts, expires_at)
       VALUES ('login_identity', $1, 1, CURRENT_TIMESTAMP + interval '1 hour')
       ON CONFLICT (scope, key_hash) DO UPDATE SET attempts = fcmatch.login_attempts.attempts + 1`,
        [key],
      );
    await Promise.all([increment(), increment()]);
    const result = await pool.query(
      'SELECT attempts FROM fcmatch.login_attempts WHERE scope = $1 AND key_hash = $2',
      ['login_identity', key],
    );
    assert.equal(result.rows[0].attempts, 2);
  } finally {
    await pool.query(
      'DELETE FROM fcmatch.login_attempts WHERE scope = $1 AND key_hash = $2',
      ['login_identity', key],
    );
  }
});
