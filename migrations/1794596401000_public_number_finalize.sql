-- Up Migration
SET LOCAL lock_timeout = '5s';
-- En bases grandes, aplicar primero expand y ejecutar el backfill por lotes.
DO $block$
BEGIN
  IF (SELECT count(*) FROM fcmatch.users WHERE public_number IS NULL) > 10000 THEN
    RAISE EXCEPTION 'Ejecutar el backfill por lotes antes de finalizar la migración.';
  END IF;
END;
$block$;
UPDATE fcmatch.users SET public_number = nextval('fcmatch.users_public_number_seq')
  WHERE public_number IS NULL;
ALTER TABLE fcmatch.users VALIDATE CONSTRAINT users_public_number_range_ck;
ALTER TABLE fcmatch.users ADD CONSTRAINT users_public_number_not_null_ck
  CHECK (public_number IS NOT NULL) NOT VALID;
ALTER TABLE fcmatch.users VALIDATE CONSTRAINT users_public_number_not_null_ck;
ALTER TABLE fcmatch.users ALTER COLUMN public_number SET NOT NULL;
ALTER TABLE fcmatch.users DROP CONSTRAINT users_public_number_not_null_ck;

-- Down Migration
DO $block$ BEGIN RAISE EXCEPTION 'Migración irreversible: conservar los identificadores asignados.'; END $block$;
