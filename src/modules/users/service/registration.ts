import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { IdentityRepository } from '../repository/identity.js';
import type { Registration } from '../dto/registration.js';
import { ApiError } from '../../../shared/errors/api-error.js';

export type VerificationDelivery = { email: string; token: string };
export const tokenDigest = (token: string) =>
  createHash('sha256').update(token).digest();
export const abuseDigest = (secret: string, scope: string, value: string) =>
  createHmac('sha256', secret).update(`${scope}\0${value}`).digest();
const invalidToken = () =>
  new ApiError(
    400,
    'ACTION_TOKEN_INVALID',
    'El enlace no es válido o ha vencido.',
  );

export class RegistrationService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly hashPassword: (password: string) => Promise<string>,
    private readonly deliver: (message: VerificationDelivery) => Promise<void>,
    private readonly abuseSecret: string,
  ) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    try {
      return await this.repository.transaction(work);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'El servicio no está disponible. Inténtalo más tarde.',
      );
    }
  }
  private async bucket(
    client: PoolClient,
    scope: string,
    value: string,
    seconds: number,
    limit: number,
    cooldown: number,
  ) {
    const bucket = await this.repository.bucket(
      client,
      scope,
      abuseDigest(this.abuseSecret, scope, value),
      seconds,
    );
    if (
      bucket.now.getTime() - bucket.window_started_at.getTime() >=
      seconds * 1000
    ) {
      await this.repository.resetBucket(client, bucket.id, seconds);
      return { allowed: true, retry: 0 };
    }
    const remaining =
      seconds -
      (bucket.now.getTime() - bucket.window_started_at.getTime()) / 1000;
    const waiting =
      cooldown - (bucket.now.getTime() - bucket.updated_at.getTime()) / 1000;
    if (bucket.attempts >= limit || (bucket.attempts > 0 && waiting > 0))
      return {
        allowed: false,
        retry: Math.ceil(
          Math.max(1, bucket.attempts >= limit ? remaining : waiting),
        ),
      };
    await this.repository.incrementBucket(client, bucket.id);
    return { allowed: true, retry: 0 };
  }
  async admitMail(email: string, ip: string) {
    const result = await this.transaction(async (client) => {
      const ipLimit = await this.bucket(client, 'email_ip', ip, 900, 10, 0);
      if (!ipLimit.allowed) return { ipLimit, identity: false };
      const identity = await this.bucket(
        client,
        'email_identity',
        email,
        3600,
        5,
        60,
      );
      return { ipLimit, identity: identity.allowed };
    });
    if (!result.ipLimit.allowed)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Demasiadas solicitudes. Inténtalo más tarde.',
        [{ retryAfter: result.ipLimit.retry }],
      );
    return result.identity;
  }
  async register(input: Registration, ip: string) {
    if (!(await this.admitMail(input.email, ip))) return;
    // La misma operación costosa para correos nuevos y existentes, fuera de locks SQL.
    const passwordHash = await this.hashPassword(input.password);
    const token = randomBytes(32).toString('base64url');
    const delivery = await this.transaction(async (client) => {
      if (await this.repository.usernameExists(client, input.username))
        throw new ApiError(
          409,
          'USERNAME_UNAVAILABLE',
          'El nombre de usuario no está disponible.',
        );
      const user = await this.repository.insertUser(
        client,
        input.email,
        input.username,
        passwordHash,
      );
      if (!user) {
        if (await this.repository.usernameExists(client, input.username))
          throw new ApiError(
            409,
            'USERNAME_UNAVAILABLE',
            'El nombre de usuario no está disponible.',
          );
        return undefined;
      }
      await this.repository.createVerification(
        client,
        user.id,
        tokenDigest(token),
      );
      return { email: user.email, token };
    });
    if (delivery) await this.deliver(delivery);
  }
  async resend(email: string, ip: string) {
    if (!(await this.admitMail(email, ip))) return;
    const token = randomBytes(32).toString('base64url');
    const delivery = await this.transaction(async (client) => {
      const user = await this.repository.userByEmail(client, email);
      if (!user || user.email_verified_at) return undefined;
      await this.repository.createVerification(
        client,
        user.id,
        tokenDigest(token),
      );
      return { email: user.email, token };
    });
    if (delivery) await this.deliver(delivery);
  }
  async verify(token: string) {
    const verified = await this.transaction(async (client) => {
      const action = await this.repository.findVerification(
        client,
        tokenDigest(token),
      );
      if (!action) return false;
      // Todos los caminos que emiten/confirman bloquean usuario antes de modificar tokens.
      const user = await this.repository.userById(client, action.user_id);
      if (!user || user.email_verified_at) return false;
      if (!(await this.repository.consumeVerification(client, action.id)))
        return false;
      await this.repository.verifyUser(client, user.id);
      await this.repository.revokeSiblings(client, user.id, action.id);
      return true;
    });
    if (!verified) throw invalidToken();
  }
}
