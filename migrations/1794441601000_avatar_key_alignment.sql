-- Up Migration
-- Alinear el diario técnico con users.avatar_key sin modificar migraciones aplicadas.
ALTER TABLE fcmatch.avatar_objects DROP CONSTRAINT avatar_objects_object_key_check;
ALTER TABLE fcmatch.avatar_objects ADD CONSTRAINT avatar_objects_object_key_check
  CHECK (object_key ~ '^avatars/[a-f0-9]{32}[.](jpg|png|webp)$' OR object_key ~ '^avatars/[a-f0-9-]{36}[.](jpg|png|webp)$');

-- Down Migration
ALTER TABLE fcmatch.avatar_objects DROP CONSTRAINT avatar_objects_object_key_check;
ALTER TABLE fcmatch.avatar_objects ADD CONSTRAINT avatar_objects_object_key_check
  CHECK (object_key ~ '^avatars/[a-f0-9-]{36}[.](jpg|png|webp)$');
