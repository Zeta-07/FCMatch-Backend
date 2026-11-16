import type { PoolClient } from 'pg';
import { IdentityRepository } from './identity.js';

export type ProfileRow = {
  id: string;
  public_id: string;
  public_number: number;
  username: string;
  league_name: string | null;
  avatar_key: string | null;
  email: string;
  email_verified_at: Date | null;
};
const columns =
  'id, public_id, public_number, username, league_name, avatar_key, email, email_verified_at';
export class ProfilesRepository extends IdentityRepository {
  async cleanupUsers(client: PoolClient) {
    return (
      await client.query<{
        user_id: string;
      }>(`SELECT DISTINCT user_id FROM fcmatch.avatar_objects WHERE state = 'retired'
      OR (state = 'reserved' AND created_at < clock_timestamp() - interval '15 minutes') LIMIT 50`)
    ).rows;
  }
  async own(client: PoolClient, id: string) {
    return (
      await client.query<ProfileRow>(
        `SELECT ${columns} FROM fcmatch.users WHERE id = $1`,
        [id],
      )
    ).rows[0];
  }
  async publicProfile(client: PoolClient, id: string) {
    return (
      await client.query<ProfileRow>(
        `SELECT ${columns} FROM fcmatch.users WHERE public_id = $1`,
        [id],
      )
    ).rows[0];
  }
  async patch(
    client: PoolClient,
    id: string,
    input: {
      username?: string | undefined;
      leagueName?: string | null | undefined;
    },
  ) {
    return (
      await client.query<ProfileRow>(
        `UPDATE fcmatch.users SET username = COALESCE($2, username),
      league_name = CASE WHEN $3 THEN $4 ELSE league_name END WHERE id = $1 RETURNING ${columns}`,
        [
          id,
          input.username ?? null,
          input.leagueName !== undefined,
          input.leagueName ?? null,
        ],
      )
    ).rows[0]!;
  }
  async byPublicNumber(client: PoolClient, number: string) {
    return (
      await client.query<ProfileRow>(
        `SELECT ${columns} FROM fcmatch.users WHERE public_number = $1::integer`,
        [number],
      )
    ).rows[0];
  }
  async search(
    client: PoolClient,
    prefix: string,
    limit: number,
    after?: { username: string; publicId: string },
    number: number | null = null,
  ) {
    const escaped = prefix.replace(/[\\%_]/g, '\\$&') + '%';
    return (
      await client.query<ProfileRow>(
        `SELECT ${columns} FROM fcmatch.users
      WHERE (lower(username) LIKE $1 COLLATE "C" OR public_number = $5::integer) AND ($2::text IS NULL OR (lower(username) COLLATE "C", public_id) > ($2 COLLATE "C", $3::uuid))
      ORDER BY lower(username) COLLATE "C", public_id LIMIT $4`,
        [
          escaped,
          after?.username ?? null,
          after?.publicId ?? null,
          limit + 1,
          number,
        ],
      )
    ).rows;
  }
  async reserve(client: PoolClient, user: string, key: string) {
    await client.query(
      'INSERT INTO fcmatch.avatar_objects (object_key,user_id) VALUES ($1,$2)',
      [key, user],
    );
  }
  async activate(client: PoolClient, user: string, key: string) {
    const row = await client.query(
      `UPDATE fcmatch.avatar_objects SET state = 'active' WHERE object_key = $1 AND user_id = $2 AND state = 'reserved' RETURNING object_key`,
      [key, user],
    );
    if (row.rowCount !== 1) throw new Error('Reserva no utilizable.');
    await client.query(
      `UPDATE fcmatch.avatar_objects SET state = 'retired' WHERE user_id = $1 AND state = 'active' AND object_key <> $2`,
      [user, key],
    );
    await client.query(
      'UPDATE fcmatch.users SET avatar_key = $2 WHERE id = $1',
      [user, key],
    );
  }
  async detach(client: PoolClient, user: string) {
    await client.query(
      'UPDATE fcmatch.users SET avatar_key = NULL WHERE id = $1',
      [user],
    );
    await client.query(
      "UPDATE fcmatch.avatar_objects SET state = 'retired' WHERE user_id = $1 AND state = 'active'",
      [user],
    );
  }
  async retireReservation(client: PoolClient, key: string, user: string) {
    // Una petición suspendida puede terminar después de limpiar su reserva vencida.
    // Restituir el diario de compensación, nunca sobrescribir una foto activa.
    await client.query(
      "INSERT INTO fcmatch.avatar_objects (object_key,user_id,state) VALUES ($1,$2,'retired') ON CONFLICT (object_key) DO NOTHING",
      [key, user],
    );
    await client.query(
      "UPDATE fcmatch.avatar_objects SET state = 'retired' WHERE object_key = $1 AND state = 'reserved'",
      [key],
    );
  }
  async cleanupCandidates(client: PoolClient, user: string) {
    await client.query(
      `UPDATE fcmatch.avatar_objects SET state = 'retired' WHERE user_id = $1 AND state = 'reserved' AND created_at < clock_timestamp() - interval '15 minutes'`,
      [user],
    );
    return (
      await client.query<{ object_key: string }>(
        `SELECT object_key FROM fcmatch.avatar_objects o WHERE user_id = $1 AND state = 'retired'
      AND NOT EXISTS (SELECT 1 FROM fcmatch.users u WHERE u.avatar_key = o.object_key) LIMIT 50`,
        [user],
      )
    ).rows;
  }
  async cleaned(client: PoolClient, key: string) {
    await client.query(
      "DELETE FROM fcmatch.avatar_objects WHERE object_key = $1 AND state = 'retired'",
      [key],
    );
  }
  async emailRequest(
    client: PoolClient,
    user: string,
    destination: string,
    hash: Buffer,
  ) {
    await client.query(
      `UPDATE fcmatch.action_tokens SET revoked_at = clock_timestamp() WHERE user_id = $1 AND purpose = 'email_change'
      AND new_email <> $2 AND used_at IS NULL AND revoked_at IS NULL`,
      [user, destination],
    );
    const occupied = await client.query(
      'SELECT 1 FROM fcmatch.users WHERE email = $1',
      [destination],
    );
    if (occupied.rowCount) return false;
    await client.query(
      `INSERT INTO fcmatch.action_tokens (user_id,purpose,new_email,token_hash,expires_at)
      VALUES ($1,'email_change',$2,$3,CURRENT_TIMESTAMP + interval '30 minutes')`,
      [user, destination, hash],
    );
    return true;
  }
  async emailAction(client: PoolClient, user: string, hash: Buffer) {
    return (
      await client.query<{ id: string; new_email: string }>(
        `SELECT id,new_email FROM fcmatch.action_tokens WHERE user_id = $1 AND token_hash = $2 AND purpose = 'email_change'
      AND used_at IS NULL AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`,
        [user, hash],
      )
    ).rows[0];
  }
  async applyEmail(
    client: PoolClient,
    user: string,
    action: { id: string; new_email: string },
  ) {
    await client.query(
      'UPDATE fcmatch.users SET email = $2, email_verified_at = clock_timestamp() WHERE id = $1',
      [user, action.new_email],
    );
    await client.query(
      'UPDATE fcmatch.action_tokens SET used_at = clock_timestamp() WHERE id = $1',
      [action.id],
    );
    await client.query(
      `UPDATE fcmatch.action_tokens SET revoked_at = clock_timestamp() WHERE user_id = $1 AND purpose IN ('email_change','reset_password','verify_email') AND used_at IS NULL AND revoked_at IS NULL`,
      [user],
    );
  }
}
