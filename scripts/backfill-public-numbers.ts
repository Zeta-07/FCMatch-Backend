import { createPool } from '../src/shared/db/pool.js';
import { loadConfig } from '../src/shared/config/env.js';

// Solo tras aplicar expand. No imprime datos personales ni reinicia secuencias.
const pool = createPool(loadConfig().DATABASE_URL);
try {
  let count = 0;
  for (;;) {
    const result = await pool.query(`WITH batch AS (
      SELECT id FROM fcmatch.users WHERE public_number IS NULL
      ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED
    ) UPDATE fcmatch.users u SET public_number = nextval('fcmatch.users_public_number_seq')
      FROM batch WHERE u.id = batch.id AND u.public_number IS NULL`);
    count += result.rowCount ?? 0;
    if (!result.rowCount) break;
  }
  console.info(
    `Backfill completado: ${count} asignaciones. Verificar nulos antes de finalizar.`,
  );
} finally {
  await pool.end();
}
