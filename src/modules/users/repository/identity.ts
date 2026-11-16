import type { Pool, PoolClient } from 'pg';

export type Bucket = {
  id: string;
  attempts: number;
  window_started_at: Date;
  updated_at: Date;
  now: Date;
};
export type IdentityUser = {
  id: string;
  email: string;
  email_verified_at: Date | null;
};
export type Action = {
  id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  now: Date;
};

export class IdentityRepository {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '3s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async bucket(
    client: PoolClient,
    scope: string,
    key: Buffer,
    windowSeconds: number,
  ): Promise<Bucket> {
    await client.query(
      `INSERT INTO fcmatch.login_attempts (scope, key_hash, expires_at)
      VALUES ($1, $2, clock_timestamp() + make_interval(secs => $3)) ON CONFLICT (scope, key_hash) DO NOTHING`,
      [scope, key, windowSeconds],
    );
    const result = await client.query<Bucket>(
      `SELECT id, attempts, window_started_at, updated_at, clock_timestamp() AS now
      FROM fcmatch.login_attempts WHERE scope = $1 AND key_hash = $2 FOR UPDATE`,
      [scope, key],
    );
    return result.rows[0]!;
  }
  async resetBucket(client: PoolClient, id: string, seconds: number) {
    await client.query(
      `UPDATE fcmatch.login_attempts SET attempts = 1, window_started_at = clock_timestamp(),
      expires_at = clock_timestamp() + make_interval(secs => $2), locked_until = NULL WHERE id = $1`,
      [id, seconds],
    );
  }
  async incrementBucket(client: PoolClient, id: string) {
    await client.query(
      'UPDATE fcmatch.login_attempts SET attempts = attempts + 1 WHERE id = $1',
      [id],
    );
  }
  async usernameExists(client: PoolClient, username: string) {
    const result = await client.query(
      'SELECT 1 FROM fcmatch.users WHERE lower(username) = lower($1) COLLATE "C"',
      [username],
    );
    return result.rowCount !== 0;
  }
  async insertUser(
    client: PoolClient,
    email: string,
    username: string,
    passwordHash: string,
  ) {
    const result = await client.query<IdentityUser>(
      `INSERT INTO fcmatch.users (email, username, password_hash)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id, email, email_verified_at`,
      [email, username, passwordHash],
    );
    return result.rows[0];
  }
  async userByEmail(client: PoolClient, email: string) {
    const result = await client.query<IdentityUser>(
      'SELECT id, email, email_verified_at FROM fcmatch.users WHERE email = $1 FOR UPDATE',
      [email],
    );
    return result.rows[0];
  }
  async userById(client: PoolClient, id: string) {
    const result = await client.query<IdentityUser>(
      'SELECT id, email, email_verified_at FROM fcmatch.users WHERE id = $1 FOR UPDATE',
      [id],
    );
    return result.rows[0];
  }
  async createVerification(
    client: PoolClient,
    userId: string,
    tokenHash: Buffer,
  ) {
    await client.query(
      `INSERT INTO fcmatch.action_tokens (user_id, purpose, token_hash, expires_at)
      VALUES ($1, 'verify_email', $2, CURRENT_TIMESTAMP + interval '24 hours')`,
      [userId, tokenHash],
    );
  }
  async findVerification(client: PoolClient, hash: Buffer) {
    const result = await client.query<Action>(
      `SELECT id, user_id, expires_at, used_at, revoked_at, clock_timestamp() AS now
      FROM fcmatch.action_tokens WHERE token_hash = $1 AND purpose = 'verify_email'`,
      [hash],
    );
    return result.rows[0];
  }
  async consumeVerification(client: PoolClient, id: string) {
    const result = await client.query(
      `UPDATE fcmatch.action_tokens SET used_at = clock_timestamp()
      WHERE id = $1 AND purpose = 'verify_email' AND used_at IS NULL AND revoked_at IS NULL
      AND expires_at > clock_timestamp() RETURNING id`,
      [id],
    );
    return result.rowCount === 1;
  }
  async verifyUser(client: PoolClient, id: string) {
    await client.query(
      'UPDATE fcmatch.users SET email_verified_at = clock_timestamp() WHERE id = $1 AND email_verified_at IS NULL',
      [id],
    );
  }
  async revokeSiblings(client: PoolClient, userId: string, actionId: string) {
    await client.query(
      `UPDATE fcmatch.action_tokens SET revoked_at = clock_timestamp()
      WHERE user_id = $1 AND purpose = 'verify_email' AND id <> $2 AND used_at IS NULL AND revoked_at IS NULL`,
      [userId, actionId],
    );
  }
}
