import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SessionsRepository, type SessionRow } from '../repository/sessions.js';
import { ApiError } from '../../../shared/errors/api-error.js';
import {
  AccessTokens,
  unauthenticated,
  type BrowserContext,
} from './access-token.js';
import {
  abuseDigest,
  tokenDigest,
  type VerificationDelivery,
  type RegistrationService,
} from './registration.js';

export type PasswordCrypto = {
  hash: (password: string) => Promise<string>;
  verify: (stored: string | undefined, password: string) => Promise<boolean>;
};
export class SessionsService {
  constructor(
    private readonly repo: SessionsRepository,
    private readonly passwords: PasswordCrypto,
    private readonly tokens: AccessTokens,
    private readonly abuseSecret: string,
    private readonly registration: RegistrationService,
    private readonly deliverReset: (
      message: VerificationDelivery,
    ) => Promise<void>,
  ) {}
  private async tx<T>(work: (client: PoolClient) => Promise<T>) {
    try {
      return await this.repo.transaction(work);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'El servicio no está disponible. Inténtalo más tarde.',
      );
    }
  }
  private match(root: SessionRow, context: BrowserContext) {
    if (
      root.client_origin !== context.origin ||
      root.client_context !== context.client ||
      root.id !== context.csrfFamily
    )
      throw new ApiError(
        403,
        'CSRF_INVALID',
        'La protección de la solicitud no es válida.',
      );
  }
  private alive(
    root: SessionRow | undefined,
    user: string,
  ): root is SessionRow {
    return Boolean(
      root &&
      root.user_id === user &&
      root.parent_id === null &&
      root.id === root.family_id &&
      !root.revoked_at &&
      root.expires_at > root.now,
    );
  }
  private async grant(
    root: SessionRow,
    refreshToken: string,
    context: BrowserContext,
  ) {
    return {
      ...(await this.tokens.issue(
        root.user_id,
        root.id,
        root.expires_at,
        context,
      )),
      tokenType: 'Bearer' as const,
      sessionExpiresAt: root.expires_at.toISOString(),
      family: root.id,
      refreshToken,
    };
  }
  async binding(refresh: string, context: Omit<BrowserContext, 'csrfFamily'>) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(refresh)) return '';
    return this.tx(async (client) => {
      const row = await this.repo.byRefresh(client, tokenDigest(refresh));
      return row &&
        row.client_origin === context.origin &&
        row.client_context === context.client
        ? row.family_id
        : '';
    });
  }
  async login(
    email: string,
    password: string,
    ip: string,
    context: BrowserContext,
    device: string,
  ) {
    const admitted = await this.tx(async (client) => {
      const row = await this.repo.bucket(
        client,
        'login_ip',
        abuseDigest(this.abuseSecret, 'login_ip', ip),
        900,
      );
      if (row.now.getTime() - row.window_started_at.getTime() >= 900_000) {
        await this.repo.resetBucket(client, row.id, 900);
        return true;
      }
      if (row.attempts >= 30) return false;
      await this.repo.incrementBucket(client, row.id);
      return true;
    });
    if (!admitted)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Demasiadas solicitudes. Inténtalo más tarde.',
        [{ retryAfter: 900 }],
      );
    const snapshot = await this.tx((client) =>
      this.repo.credentials(client, email),
    );
    const correct = await this.passwords.verify(
      snapshot?.password_hash,
      password,
    );
    const refresh = randomBytes(32).toString('base64url');
    const root = await this.tx(async (client) => {
      const key = abuseDigest(this.abuseSecret, 'login_identity', email);
      const bucket = await this.repo.loginBucket(client, key);
      if (bucket.locked_until && bucket.locked_until > bucket.now)
        return undefined;
      const failures =
        bucket.now.getTime() - bucket.window_started_at.getTime() >= 900_000
          ? 0
          : bucket.attempts;
      const user = snapshot
        ? await this.repo.lockedUser(client, snapshot.id)
        : undefined;
      if (
        !correct ||
        !user?.email_verified_at ||
        user.password_hash !== snapshot?.password_hash
      ) {
        await this.repo.loginResult(
          client,
          key,
          failures + 1,
          failures + 1 >= 10,
        );
        return undefined;
      }
      await this.repo.loginResult(client, key, 0, false);
      return this.repo.root(
        client,
        randomUUID(),
        user.id,
        tokenDigest(refresh),
        context.client,
        context.origin,
        device,
      );
    });
    if (!root) throw unauthenticated();
    return this.grant(root, refresh, context);
  }
  async refresh(refresh: string, context: BrowserContext) {
    const next = randomBytes(32).toString('base64url');
    const root = await this.tx(async (client) => {
      const candidate = await this.repo.byRefresh(client, tokenDigest(refresh));
      if (!candidate) return undefined;
      const user = await this.repo.lockedUser(client, candidate.user_id);
      const family = await this.repo.session(client, candidate.family_id);
      if (!family) return undefined;
      this.match(family, context);
      if (!user?.email_verified_at || !this.alive(family, candidate.user_id))
        return undefined;
      const generation = await this.repo.session(client, candidate.id);
      if (!generation) return undefined;
      if (generation.consumed_at || generation.revoked_at) {
        await this.repo.revokeFamily(client, family.id);
        return undefined; // No lanzar dentro de la transacción: el replay debe quedar revocado.
      }
      if (!(await this.repo.consume(client, generation.id))) return undefined;
      await this.repo.successor(
        client,
        family,
        generation.id,
        tokenDigest(next),
      );
      return family;
    });
    if (!root) throw unauthenticated();
    return this.grant(root, next, context);
  }
  async authenticate(access: string, context: BrowserContext) {
    return this.authorized(access, context, async (_client, user, root) => ({
      user,
      root,
    }));
  }
  async authorized<T>(
    access: string,
    context: BrowserContext,
    work: (
      client: PoolClient,
      user: import('../repository/sessions.js').Credentials,
      root: SessionRow,
    ) => Promise<T>,
    readOnly = false,
  ) {
    const claims = await this.tokens.verify(access, context);
    return this.tx(async (client) => {
      const user = await this.repo.lockedUser(client, claims.userId);
      const root = await this.repo.session(client, claims.family);
      if (!user?.email_verified_at || !this.alive(root, claims.userId))
        throw unauthenticated();
      if (readOnly) {
        if (
          root.client_origin !== context.origin ||
          root.client_context !== context.client
        )
          throw unauthenticated();
      } else this.match(root, context);
      return work(client, user, root);
    });
  }
  async logout(refresh: string, context: BrowserContext) {
    await this.tx(async (client) => {
      const row = await this.repo.byRefresh(client, tokenDigest(refresh));
      if (!row) return;
      await this.repo.lockedUser(client, row.user_id);
      const root = await this.repo.session(client, row.family_id);
      if (!root) return;
      this.match(root, context);
      await this.repo.revokeFamily(client, root.id);
    });
  }
  async logoutAll(access: string, context: BrowserContext) {
    const claims = await this.tokens.verify(access, context);
    await this.tx(async (client) => {
      const user = await this.repo.lockedUser(client, claims.userId);
      const root = await this.repo.session(client, claims.family);
      if (!user?.email_verified_at || !this.alive(root, claims.userId))
        throw unauthenticated();
      this.match(root, context);
      await this.repo.revokeAll(client, user.id);
    });
  }
  async forgot(email: string, ip: string) {
    if (!(await this.registration.admitMail(email, ip))) return;
    const token = randomBytes(32).toString('base64url');
    const delivery = await this.tx(async (client) => {
      const user = await this.repo.userByEmail(client, email);
      if (!user?.email_verified_at) return undefined;
      await this.repo.resetToken(client, user.id, tokenDigest(token));
      return { email: user.email, token };
    });
    if (delivery) await this.deliverReset(delivery);
  }
  async reset(token: string, newPassword: string) {
    const hash = await this.passwords.hash(newPassword);
    const changed = await this.tx(async (client) => {
      const action = await this.repo.findReset(client, tokenDigest(token));
      if (!action) return false;
      const user = await this.repo.lockedUser(client, action.user_id);
      if (
        !user?.email_verified_at ||
        !(await this.repo.consumeReset(client, action.id))
      )
        return false;
      await this.repo.changePassword(client, user.id, hash);
      await this.repo.revokeAll(client, user.id);
      return true;
    });
    if (!changed)
      throw new ApiError(
        400,
        'ACTION_TOKEN_INVALID',
        'El enlace no es válido o ha vencido.',
      );
  }
  async change(
    access: string,
    currentPassword: string,
    newPassword: string,
    context: BrowserContext,
  ) {
    const snapshot = await this.verifyCurrentPassword(
      access,
      currentPassword,
      context,
    );
    const hash = await this.passwords.hash(newPassword);
    await this.authorized(access, context, async (client, user) => {
      if (user.password_hash !== snapshot.user.password_hash)
        throw unauthenticated();
      await this.repo.changePassword(client, user.id, hash);
      await this.repo.revokeAll(client, user.id);
    });
  }
  async verifyCurrentPassword(
    access: string,
    currentPassword: string,
    context: BrowserContext,
  ) {
    const snapshot = await this.authenticate(access, context);
    const correct = await this.passwords.verify(
      snapshot.user.password_hash,
      currentPassword,
    );
    const permitted = await this.tx(async (client) => {
      const key = abuseDigest(
        this.abuseSecret,
        'login_identity',
        snapshot.user.email,
      );
      const bucket = await this.repo.loginBucket(client, key);
      if (bucket.locked_until && bucket.locked_until > bucket.now) return false;
      const failures =
        bucket.now.getTime() - bucket.window_started_at.getTime() >= 900_000
          ? 0
          : bucket.attempts;
      await this.repo.loginResult(
        client,
        key,
        correct ? 0 : failures + 1,
        !correct && failures + 1 >= 10,
      );
      return correct;
    });
    if (!permitted) throw unauthenticated();
    return snapshot;
  }
}
