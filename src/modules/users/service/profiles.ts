import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ProfilesRepository, type ProfileRow } from '../repository/profiles.js';
import type { SessionsService } from './sessions.js';
import {
  tokenDigest,
  type RegistrationService,
  type VerificationDelivery,
} from './registration.js';
import type { BrowserContext } from '../../../shared/types/browser-context.js';
import type { AvatarStorage } from '../../../shared/storage/avatars.js';
import { ApiError } from '../../../shared/errors/api-error.js';
import { unauthenticated } from './access-token.js';
import { validateAvatar } from './avatar-image.js';
import { cleanupAvatarObjects } from './avatar-cleanup.js';

const unavailable = () =>
  new ApiError(
    503,
    'SERVICE_UNAVAILABLE',
    'El servicio no está disponible. Inténtalo más tarde.',
  );
const invalidToken = () =>
  new ApiError(
    400,
    'ACTION_TOKEN_INVALID',
    'El enlace no es válido o ha vencido.',
  );
const cursorData = z.strictObject({
  search: z.string(),
  username: z.string().regex(/^[a-z0-9_]{3,30}$/),
  publicId: z.uuid(),
});
export class ProfilesService {
  constructor(
    private readonly repo: ProfilesRepository,
    private readonly sessions: SessionsService,
    private readonly registration: RegistrationService,
    private readonly storage: AvatarStorage | null,
    private readonly cursorSecret: string,
    private readonly deliver: (message: VerificationDelivery) => Promise<void>,
  ) {}
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const db = error as { code?: string; constraint?: string };
      if (db.code === '23505' && db.constraint === 'users_username_ci_uq')
        throw new ApiError(
          409,
          'USERNAME_UNAVAILABLE',
          'El nombre de usuario no está disponible.',
        );
      throw unavailable();
    }
  }
  private async view(row: ProfileRow, own = false) {
    const profile = {
      publicId: row.public_id,
      username: row.username,
      leagueName: row.league_name,
      avatar: row.avatar_key
        ? await this.requiredStorage().sign(row.avatar_key)
        : null,
      statistics: null,
      history: [],
    };
    return own
      ? {
          profile,
          email: row.email,
          emailVerifiedAt: row.email_verified_at!.toISOString(),
        }
      : profile;
  }
  private requiredStorage() {
    if (!this.storage) throw unavailable();
    return this.storage;
  }
  async own(access: string, context: BrowserContext) {
    return this.safe(async () => {
      const row = await this.sessions.authorized(
        access,
        context,
        (client, user) => this.repo.own(client, user.id),
        true,
      );
      if (!row) throw unauthenticated();
      return this.view(row, true);
    });
  }
  async publicProfile(id: string) {
    return this.safe(async () => {
      const row = await this.repo.transaction((client) =>
        this.repo.publicProfile(client, id),
      );
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Perfil no encontrado.');
      return this.view(row);
    });
  }
  async patch(
    access: string,
    context: BrowserContext,
    input: {
      username?: string | undefined;
      leagueName?: string | null | undefined;
    },
  ) {
    return this.safe(async () => {
      const row = await this.sessions.authorized(
        access,
        context,
        (client, user) =>
          this.safe(() => this.repo.patch(client, user.id, input)),
      );
      return this.view(row, true);
    });
  }
  private mac(value: string) {
    return createHmac('sha256', this.cursorSecret)
      .update('profiles-cursor\0' + value)
      .digest('base64url');
  }
  async search(
    access: string,
    context: BrowserContext,
    search: string,
    limit: number,
    cursor?: string,
  ) {
    return this.safe(async () => {
      let after: z.infer<typeof cursorData> | undefined;
      if (cursor) {
        try {
          const [value, signature] = cursor.split('.');
          const expected = this.mac(value!);
          if (
            !signature ||
            signature.length !== expected.length ||
            !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
          )
            throw new Error();
          after = cursorData.parse(
            JSON.parse(Buffer.from(value!, 'base64url').toString()),
          );
          if (after.search !== search) throw new Error();
        } catch {
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'El cursor no es válido para esta búsqueda.',
          );
        }
      }
      const rows = await this.sessions.authorized(
        access,
        context,
        (client) => this.repo.search(client, search, limit, after),
        true,
      );
      const more = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      let nextCursor: string | null = null;
      if (more && last) {
        const value = Buffer.from(
          JSON.stringify({
            search,
            username: last.username.toLowerCase(),
            publicId: last.public_id,
          }),
        ).toString('base64url');
        nextCursor = `${value}.${this.mac(value)}`;
      }
      return {
        items: await Promise.all(page.map((row) => this.view(row))),
        nextCursor,
      };
    });
  }
  async cleanup(userId: string) {
    await cleanupAvatarObjects(this.repo, this.requiredStorage(), userId);
  }
  async replace(
    access: string,
    context: BrowserContext,
    bytes: Buffer,
    mime: string,
  ) {
    return this.safe(async () => {
      const storage = this.requiredStorage();
      const snapshot = await this.sessions.authenticate(access, context);
      const image = await validateAvatar(bytes, mime);
      const key = `avatars/${randomBytes(16).toString('hex')}.${image.extension}`;
      await this.sessions.authorized(access, context, (client, user) =>
        this.repo.reserve(client, user.id, key),
      );
      try {
        await storage.put(key, image.body, image.contentType);
        // Firma antes del commit: un fallo al firmar no sustituye la foto anterior.
        const signed = await storage.sign(key);
        await this.sessions.authorized(access, context, (client, user) =>
          this.repo.activate(client, user.id, key),
        );
        await this.cleanup(snapshot.user.id);
        return signed;
      } catch (error) {
        // Si COMMIT fue ambiguo, nunca borrar una foto activa: solo retirar reservas.
        await this.repo
          .transaction((client) =>
            this.repo.retireReservation(client, key, snapshot.user.id),
          )
          .catch(() => {});
        await this.cleanup(snapshot.user.id).catch(() => {});
        throw error;
      }
    });
  }
  async remove(access: string, context: BrowserContext) {
    return this.safe(async () => {
      const user = await this.sessions.authorized(
        access,
        context,
        async (client, user) => {
          await this.repo.detach(client, user.id);
          return user.id;
        },
      );
      await this.cleanup(user);
    });
  }
  async requestEmail(
    access: string,
    context: BrowserContext,
    destination: string,
    currentPassword: string,
    ip: string,
  ) {
    return this.safe(async () => {
      const snapshot = await this.sessions.verifyCurrentPassword(
        access,
        currentPassword,
        context,
      );
      if (!(await this.registration.admitMail(destination, ip))) return;
      const token = randomBytes(32).toString('base64url');
      const send = await this.sessions.authorized(
        access,
        context,
        async (client, user) => {
          if (
            user.password_hash !== snapshot.user.password_hash ||
            user.email !== snapshot.user.email
          )
            throw unauthenticated();
          // Revocar destinos anteriores incluso si el nuevo destino ya está ocupado, sin enumerarlo.
          return this.repo.emailRequest(
            client,
            user.id,
            destination,
            tokenDigest(token),
          );
        },
      );
      if (send) await this.deliver({ email: destination, token });
    });
  }
  async confirmEmail(access: string, context: BrowserContext, token: string) {
    return this.safe(async () => {
      const row = await this.sessions.authorized(
        access,
        context,
        async (client, user) => {
          const action = await this.repo.emailAction(
            client,
            user.id,
            tokenDigest(token),
          );
          if (!action || action.new_email === user.email) throw invalidToken();
          try {
            await this.repo.applyEmail(client, user.id, action);
          } catch (error) {
            const db = error as { code?: string; constraint?: string };
            if (db.code === '23505' && db.constraint === 'users_email_uq')
              throw invalidToken();
            throw error;
          }
          return (await this.repo.own(client, user.id))!;
        },
      );
      return this.view(row, true);
    });
  }
}
