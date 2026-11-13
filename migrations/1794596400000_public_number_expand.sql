-- Up Migration
-- Expand-only: UUID, índices y cursores existentes permanecen intactos.
SET LOCAL lock_timeout = '5s';
CREATE SEQUENCE fcmatch.users_public_number_seq AS integer
  MINVALUE 10000000 MAXVALUE 99999999 START WITH 10000000 NO CYCLE;
ALTER TABLE fcmatch.users ADD COLUMN public_number integer;
ALTER SEQUENCE fcmatch.users_public_number_seq OWNED BY fcmatch.users.public_number;
ALTER TABLE fcmatch.users ALTER COLUMN public_number
  SET DEFAULT nextval('fcmatch.users_public_number_seq');
ALTER TABLE fcmatch.users ADD CONSTRAINT users_public_number_range_ck
  CHECK (public_number BETWEEN 10000000 AND 99999999) NOT VALID;
CREATE UNIQUE INDEX users_public_number_uq ON fcmatch.users (public_number);
CREATE FUNCTION fcmatch.public_number_guard_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  IF OLD.public_number IS NOT NULL AND NEW.public_number IS DISTINCT FROM OLD.public_number THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'El identificador público numérico es inmutable.';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER users_public_number_guard BEFORE UPDATE OF public_number ON fcmatch.users
  FOR EACH ROW EXECUTE FUNCTION fcmatch.public_number_guard_update();

-- Down Migration
DO $block$ BEGIN RAISE EXCEPTION 'Migración irreversible: conservar los identificadores asignados.'; END $block$;
