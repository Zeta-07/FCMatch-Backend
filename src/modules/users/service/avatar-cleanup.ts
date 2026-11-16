import type { ProfilesRepository } from '../repository/profiles.js';
import type { AvatarStorage } from '../../../shared/storage/avatars.js';

export async function cleanupAvatarObjects(
  repo: ProfilesRepository,
  storage: AvatarStorage,
  userId: string,
) {
  const candidates = await repo.transaction((client) =>
    repo.cleanupCandidates(client, userId),
  );
  for (const row of candidates) {
    await storage.remove(row.object_key);
    await repo.transaction((client) => repo.cleaned(client, row.object_key));
  }
}
