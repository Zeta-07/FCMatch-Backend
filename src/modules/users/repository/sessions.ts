import type { PoolClient } from 'pg';
import { IdentityRepository, type IdentityUser } from './identity.js';

export type Credentials = IdentityUser & { password_hash: string };
export type SessionRow = {
  id: string;
  user_id: string;
  family_id: string;
  parent_id: string | null;
  client_context: string;
  client_origin: string;
  device: string;
  expires_at: Date;
  consumed_at: Date | null;
  revoked_at: Date | null;
  now: Date;
};
export class SessionsRepository extends IdentityRepository {
  async credentials(client: PoolClient, email: string) {
    return (
      await client.query<Credentials>(
        'SELECT id, email, email_verified_at, password_hash FROM fcmatch.users WHERE email = $1',
        [email],
      )
    ).rows[0];
  }
  async lockedUser(client: PoolClient, id: string) {
    return (
      await client.query<Credentials>(
        'SELECT id, email, email_verified_at, password_hash FROM fcmatch.users WHERE id = $1 FOR UPDATE',
        [id],
      )
    ).rows[0];
  }
  async byRefresh(client: PoolClient, hash: Buffer) {
    return (
      await client.query<SessionRow>(
        'SELECT *, clock_timestamp() AS now FROM fcmatch.sessions WHERE refresh_token_hash = $1',
        [hash],
      )
    ).rows[0];
  }
  async session(client: PoolClient, id: string, lock = true) {
    // lock es una opción interna, nunca proviene de HTTP.
    return (
      await client.query<SessionRow>(
        `SELECT *, clock_timestamp() AS now FROM fcmatch.sessions WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0];
  }
  async root(
    client: PoolClient,
    id: string,
    user: string,
    hash: Buffer,
    context: string,
    origin: string,
    device: string,
  ) {
    return (
      await client.query<SessionRow>(
        `INSERT INTO fcmatch.sessions
      (id, family_id, user_id, refresh_token_hash, client_context, client_origin, device, expires_at)
      VALUES ($1, $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + interval '720 hours') RETURNING *, clock_timestamp() AS now`,
        [id, user, hash, context, origin, device],
      )
    ).rows[0]!;
  }
  async consume(client: PoolClient, id: string) {
    return (
      (
        await client.query(
          `UPDATE fcmatch.sessions SET consumed_at = statement_timestamp()
      WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > statement_timestamp() RETURNING id`,
          [id],
        )
      ).rowCount === 1
    );
  }
  async successor(
    client: PoolClient,
    root: SessionRow,
    parent: string,
    hash: Buffer,
  ) {
    await client.query(
      `INSERT INTO fcmatch.sessions (user_id, family_id, parent_id, refresh_token_hash, client_context, client_origin, device, expires_at)
      SELECT user_id, id, $2, $3, client_context, client_origin, device, expires_at
      FROM fcmatch.sessions WHERE id = $1`,
      // PostgreSQL conserva microsegundos; Date los truncaría y rompería la igualdad de familia.
      [root.id, parent, hash],
    );
  }
  async revokeFamily(client: PoolClient, family: string) {
    await client.query(
      'UPDATE fcmatch.sessions SET revoked_at = clock_timestamp() WHERE family_id = $1 AND revoked_at IS NULL',
      [family],
    );
  }
  async revokeAll(client: PoolClient, userId: string) {
    await client.query(
      'SELECT id FROM fcmatch.sessions WHERE user_id = $1 AND parent_id IS NULL ORDER BY id FOR UPDATE',
      [userId],
    );
    await client.query(
      'UPDATE fcmatch.sessions SET revoked_at = clock_timestamp() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }
  async loginBucket(client: PoolClient, key: Buffer) {
    await this.bucket(client, 'login_identity', key, 900);
    return (
      await client.query<{
        attempts: number;
        locked_until: Date | null;
        window_started_at: Date;
        now: Date;
      }>(
        "SELECT attempts, locked_until, window_started_at, clock_timestamp() AS now FROM fcmatch.login_attempts WHERE scope = 'login_identity' AND key_hash = $1",
        [key],
      )
    ).rows[0]!;
  }
  async loginResult(
    client: PoolClient,
    key: Buffer,
    attempts: number,
    locked: boolean,
  ) {
    await client.query(
      `UPDATE fcmatch.login_attempts SET attempts = $2, window_started_at = clock_timestamp(),
      locked_until = CASE WHEN $3 THEN clock_timestamp() + interval '15 minutes' ELSE NULL END,
      expires_at = clock_timestamp() + interval '30 minutes' WHERE scope = 'login_identity' AND key_hash = $1`,
      [key, attempts, locked],
    );
  }
  async resetToken(client: PoolClient, user: string, hash: Buffer) {
    await client.query(
      `INSERT INTO fcmatch.action_tokens (user_id, purpose, token_hash, expires_at)
      VALUES ($1,'reset_password',$2,CURRENT_TIMESTAMP + interval '30 minutes')`,
      [user, hash],
    );
  }
  async findReset(client: PoolClient, hash: Buffer) {
    return (
      await client.query<{ id: string; user_id: string }>(
        "SELECT id, user_id FROM fcmatch.action_tokens WHERE token_hash = $1 AND purpose = 'reset_password'",
        [hash],
      )
    ).rows[0];
  }
  async consumeReset(client: PoolClient, id: string) {
    return (
      (
        await client.query(
          `UPDATE fcmatch.action_tokens SET used_at = statement_timestamp()
      WHERE id = $1 AND purpose = 'reset_password' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > statement_timestamp() RETURNING id`,
          [id],
        )
      ).rowCount === 1
    );
  }
  async changePassword(client: PoolClient, user: string, hash: string) {
    await client.query(
      'UPDATE fcmatch.users SET password_hash = $2 WHERE id = $1',
      [user, hash],
    );
    await client.query(
      `UPDATE fcmatch.action_tokens SET revoked_at = clock_timestamp() WHERE user_id = $1
      AND purpose IN ('reset_password','email_change') AND used_at IS NULL AND revoked_at IS NULL`,
      [user],
    );
  }
}
