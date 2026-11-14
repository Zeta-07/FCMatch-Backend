import { loadConfig } from '../src/shared/config/env.js';
import { createPool } from '../src/shared/db/pool.js';
import { createAvatarStorage } from '../src/shared/storage/avatars.js';
import { ProfilesRepository } from '../src/modules/users/repository/profiles.js';
import { cleanupAvatarObjects } from '../src/modules/users/service/avatar-cleanup.js';

const config = loadConfig();
const storage = createAvatarStorage(config);
if (!storage)
  throw new Error('Configura almacenamiento antes de recuperar borrados.');
const pool = createPool(config.DATABASE_URL);
try {
  await storage.verify();
  const repo = new ProfilesRepository(pool);
  const users = await repo.transaction((client) => repo.cleanupUsers(client));
  for (const user of users)
    await cleanupAvatarObjects(repo, storage, user.user_id);
  console.log(
    'Lote de recuperación de avatares completado; solo objetos retirados no referenciados.',
  );
} catch {
  console.error(
    'No se completó la recuperación; el diario conserva operaciones pendientes.',
  );
  process.exitCode = 1;
} finally {
  storage.close();
  await pool.end();
}
