-- Up Migration
-- Registro técnico para recuperar fallos entre PostgreSQL y almacenamiento S3.
CREATE TABLE fcmatch.avatar_objects (
  object_key text PRIMARY KEY CHECK (object_key ~ '^avatars/[a-f0-9-]{36}\.(jpg|png|webp)$'),
  user_id uuid NOT NULL REFERENCES fcmatch.users(id),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX avatar_objects_user_idx ON fcmatch.avatar_objects(user_id);
CREATE INDEX avatar_objects_cleanup_idx ON fcmatch.avatar_objects(state, created_at) WHERE state <> 'active';

-- Down Migration
DROP TABLE fcmatch.avatar_objects;
