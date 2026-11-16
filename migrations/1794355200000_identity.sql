-- Up Migration
-- Etapa 2: persistencia exclusivamente. No instala endpoints ni autenticación.
CREATE TABLE fcmatch.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  username text COLLATE "C" NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  league_name text,
  avatar_key text,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_public_id_uq UNIQUE (public_id),
  CONSTRAINT users_email_uq UNIQUE (email),
  CONSTRAINT users_avatar_key_uq UNIQUE (avatar_key),
  CONSTRAINT users_username_ck CHECK (
    char_length(username) BETWEEN 3 AND 30 AND username ~ '^[A-Za-z0-9_]+$'
  ),
  CONSTRAINT users_email_ck CHECK (
    char_length(email) BETWEEN 3 AND 254
    AND email = lower(btrim(email))
    AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  -- Solo forma PHC; verificar Argon2id y calibrar parámetros pertenece al servicio futuro.
  CONSTRAINT users_password_hash_ck CHECK (
    char_length(password_hash) BETWEEN 50 AND 512
    AND password_hash ~ '^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}$'
  ),
  CONSTRAINT users_league_name_ck CHECK (
    league_name IS NULL OR (
      char_length(league_name) BETWEEN 1 AND 100 AND league_name = btrim(league_name)
    )
  ),
  CONSTRAINT users_avatar_key_ck CHECK (
    avatar_key IS NULL OR avatar_key ~ '^avatars/[0-9a-f]{32}[.](jpg|png|webp)$'
  ),
  CONSTRAINT users_timestamps_ck CHECK (
    isfinite(created_at) AND isfinite(updated_at) AND updated_at >= created_at
    AND (email_verified_at IS NULL OR (isfinite(email_verified_at) AND email_verified_at >= created_at))
  )
);

-- C permite prefijos LIKE y orden determinista sin extensión citext/trigram.
CREATE UNIQUE INDEX users_username_ci_uq
  ON fcmatch.users ((lower(username) COLLATE "C")) INCLUDE (public_id);

-- Una fila por generación de refresh: los hashes consumidos no se sobrescriben.
-- La fila raíz tiene id = family_id; el JWT futuro usará esa identidad estable.
CREATE TABLE fcmatch.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES fcmatch.users(id),
  family_id uuid NOT NULL REFERENCES fcmatch.sessions(id),
  parent_id uuid REFERENCES fcmatch.sessions(id),
  refresh_token_hash bytea NOT NULL,
  client_context text NOT NULL,
  client_origin text NOT NULL,
  device text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sessions_refresh_token_hash_uq UNIQUE (refresh_token_hash),
  CONSTRAINT sessions_parent_uq UNIQUE (parent_id),
  CONSTRAINT sessions_hash_ck CHECK (octet_length(refresh_token_hash) = 32),
  CONSTRAINT sessions_root_ck CHECK (
    (parent_id IS NULL AND id = family_id)
    OR (parent_id IS NOT NULL AND id <> family_id AND id <> parent_id)
  ),
  CONSTRAINT sessions_client_context_ck CHECK (client_context IN ('web', 'mobile_browser')),
  CONSTRAINT sessions_client_origin_ck CHECK (
    char_length(client_origin) <= 255
    AND client_origin ~ '^(https://[a-z0-9.-]+(:[0-9]{1,5})?|http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]{1,5})?)$'
  ),
  CONSTRAINT sessions_device_ck CHECK (
    char_length(device) BETWEEN 1 AND 200 AND device = btrim(device)
  ),
  CONSTRAINT sessions_timestamps_ck CHECK (
    isfinite(created_at) AND isfinite(updated_at) AND updated_at >= created_at
    AND isfinite(expires_at) AND expires_at > created_at
    AND expires_at <= created_at + interval '720 hours'
    AND (consumed_at IS NULL OR (
      isfinite(consumed_at) AND consumed_at >= created_at AND consumed_at < expires_at
    ))
    AND (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= created_at))
  )
);

CREATE INDEX sessions_user_idx ON fcmatch.sessions (user_id, expires_at);
CREATE INDEX sessions_family_idx ON fcmatch.sessions (family_id, created_at);
CREATE INDEX sessions_expiry_idx ON fcmatch.sessions (expires_at);
CREATE UNIQUE INDEX sessions_one_current_per_family_uq ON fcmatch.sessions (family_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE fcmatch.action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES fcmatch.users(id),
  purpose text NOT NULL,
  token_hash bytea NOT NULL,
  new_email text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT action_tokens_hash_uq UNIQUE (token_hash),
  CONSTRAINT action_tokens_hash_ck CHECK (octet_length(token_hash) = 32),
  CONSTRAINT action_tokens_purpose_ck CHECK (purpose IN ('verify_email', 'reset_password', 'email_change')),
  CONSTRAINT action_tokens_new_email_ck CHECK (
    (purpose = 'email_change' AND new_email IS NOT NULL
      AND char_length(new_email) BETWEEN 3 AND 254
      AND new_email = lower(btrim(new_email))
      AND new_email ~ '^[^[:space:]@]+@[^[:space:]@]+$')
    OR (purpose <> 'email_change' AND new_email IS NULL)
  ),
  CONSTRAINT action_tokens_timestamps_ck CHECK (
    isfinite(created_at) AND isfinite(updated_at) AND updated_at >= created_at
    AND isfinite(expires_at) AND expires_at > created_at
    AND expires_at <= created_at + CASE
      WHEN purpose = 'verify_email' THEN interval '24 hours'
      ELSE interval '30 minutes' END
    AND (used_at IS NULL OR (isfinite(used_at) AND used_at >= created_at AND used_at < expires_at))
    AND (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= created_at))
  )
);

CREATE INDEX action_tokens_user_purpose_idx ON fcmatch.action_tokens (user_id, purpose, created_at);
CREATE INDEX action_tokens_pending_idx ON fcmatch.action_tokens (user_id, purpose, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX action_tokens_expiry_idx ON fcmatch.action_tokens (expires_at);

-- Claves seudonimizadas (HMAC-SHA256 en el servicio futuro), también para cuentas inexistentes.
CREATE TABLE fcmatch.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  key_hash bytea NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT login_attempts_key_uq UNIQUE (scope, key_hash),
  CONSTRAINT login_attempts_scope_ck CHECK (scope IN ('login_identity', 'login_ip', 'email_identity', 'email_ip')),
  CONSTRAINT login_attempts_hash_ck CHECK (octet_length(key_hash) = 32),
  CONSTRAINT login_attempts_count_ck CHECK (attempts >= 0),
  CONSTRAINT login_attempts_timestamps_ck CHECK (
    isfinite(created_at) AND isfinite(updated_at) AND updated_at >= created_at
    AND isfinite(window_started_at) AND isfinite(expires_at) AND expires_at > window_started_at
    AND (locked_until IS NULL OR (
      isfinite(locked_until) AND locked_until >= window_started_at AND locked_until <= expires_at
    ))
  )
);

CREATE INDEX login_attempts_expiry_idx ON fcmatch.login_attempts (expires_at);

-- Integridad de metadatos y marcas terminales; no toma decisiones HTTP ni emite tokens.
CREATE FUNCTION fcmatch.identity_guard_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La identidad y fecha de creación son inmutables.';
  END IF;
  IF TG_TABLE_NAME = 'users' THEN
    IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'El identificador público es inmutable.';
    END IF;
  ELSIF TG_TABLE_NAME = 'sessions' THEN
    IF ROW(NEW.user_id, NEW.family_id, NEW.parent_id, NEW.refresh_token_hash,
      NEW.client_context, NEW.client_origin, NEW.device, NEW.expires_at)
      IS DISTINCT FROM ROW(OLD.user_id, OLD.family_id, OLD.parent_id, OLD.refresh_token_hash,
      OLD.client_context, OLD.client_origin, OLD.device, OLD.expires_at)
      OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Los metadatos de sesión y marcas terminales son inmutables.';
    END IF;
  ELSIF TG_TABLE_NAME = 'action_tokens' THEN
    IF ROW(NEW.user_id, NEW.purpose, NEW.token_hash, NEW.new_email, NEW.expires_at)
      IS DISTINCT FROM ROW(OLD.user_id, OLD.purpose, OLD.token_hash, OLD.new_email, OLD.expires_at)
      OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'El token y sus marcas terminales son inmutables.';
    END IF;
  ELSIF TG_TABLE_NAME = 'login_attempts' THEN
    IF ROW(NEW.scope, NEW.key_hash) IS DISTINCT FROM ROW(OLD.scope, OLD.key_hash) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La clave del contador es inmutable.';
    END IF;
  END IF;
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at);
  RETURN NEW;
END;
$function$;

CREATE TRIGGER users_guard_update BEFORE UPDATE ON fcmatch.users
  FOR EACH ROW EXECUTE FUNCTION fcmatch.identity_guard_update();
CREATE TRIGGER sessions_guard_update BEFORE UPDATE ON fcmatch.sessions
  FOR EACH ROW EXECUTE FUNCTION fcmatch.identity_guard_update();
CREATE TRIGGER action_tokens_guard_update BEFORE UPDATE ON fcmatch.action_tokens
  FOR EACH ROW EXECUTE FUNCTION fcmatch.identity_guard_update();
CREATE TRIGGER login_attempts_guard_update BEFORE UPDATE ON fcmatch.login_attempts
  FOR EACH ROW EXECUTE FUNCTION fcmatch.identity_guard_update();

CREATE FUNCTION fcmatch.identity_guard_session_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE
  root_row fcmatch.sessions%ROWTYPE;
  parent_row fcmatch.sessions%ROWTYPE;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Orden raíz -> padre. Los servicios futuros deben mantener el mismo orden.
  SELECT * INTO root_row FROM fcmatch.sessions WHERE id = NEW.family_id FOR UPDATE;
  IF NOT FOUND OR root_row.parent_id IS NOT NULL OR root_row.id <> root_row.family_id
    OR root_row.revoked_at IS NOT NULL
    OR ROW(NEW.user_id, NEW.client_context, NEW.client_origin, NEW.device, NEW.expires_at)
      IS DISTINCT FROM ROW(root_row.user_id, root_row.client_context, root_row.client_origin, root_row.device, root_row.expires_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La familia de sesión no es válida.';
  END IF;
  SELECT * INTO parent_row FROM fcmatch.sessions WHERE id = NEW.parent_id FOR KEY SHARE;
  IF NOT FOUND OR parent_row.family_id <> NEW.family_id OR parent_row.consumed_at IS NULL
    OR parent_row.revoked_at IS NOT NULL OR NEW.created_at < parent_row.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'El predecesor de sesión no es válido.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER sessions_guard_insert BEFORE INSERT ON fcmatch.sessions
  FOR EACH ROW EXECUTE FUNCTION fcmatch.identity_guard_session_insert();

-- Down Migration
-- Solo objetos de esta migración. Sin CASCADE ni DROP del esquema de Fase 0.
DROP TABLE fcmatch.login_attempts;
DROP TABLE fcmatch.action_tokens;
DROP TABLE fcmatch.sessions;
DROP TABLE fcmatch.users;
DROP FUNCTION fcmatch.identity_guard_session_insert();
DROP FUNCTION fcmatch.identity_guard_update();
