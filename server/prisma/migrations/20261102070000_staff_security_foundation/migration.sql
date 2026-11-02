-- Staff Access protected database foundation.
-- The chatforia_staff_owner role and staff_security schema
-- must be provisioned by the separate DBA bootstrap process.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'chatforia_staff_owner'
    AND rolcanlogin = false
    AND rolsuper = false
    AND rolcreatedb = false
    AND rolcreaterole = false
    AND rolbypassrls = false
  ) THEN
    RAISE EXCEPTION
      'Required restricted chatforia_staff_owner role is unavailable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.schemata
    WHERE schema_name = 'staff_security'
  ) THEN
    RAISE EXCEPTION
      'Required staff_security schema has not been provisioned.';
  END IF;
END
$$;

CREATE TABLE staff_security.assertion_secrets (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  verification_secret BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (octet_length(verification_secret) >= 32)
);

CREATE TABLE staff_security.consumed_assertions (
  assertion_id UUID PRIMARY KEY,
  actor_user_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'STAFF_ACCESS_GRANT_OR_CHANGE',
      'STAFF_ACCESS_REVOKE'
    )
  ),
  target_profile TEXT NOT NULL CHECK (
    target_profile IN (
      'CTO',
      'ENGINEERING_MANAGER',
      'SENIOR_ENGINEER',
      'SUPPORT',
      'ACCESS_ADMIN'
    )
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (actor_user_id > 0),
  CHECK (target_user_id > 0),
  CHECK (actor_user_id <> target_user_id)
);

CREATE INDEX consumed_assertions_expires_at_idx
  ON staff_security.consumed_assertions (expires_at);

ALTER TABLE staff_security.assertion_secrets
  OWNER TO chatforia_staff_owner;

ALTER TABLE staff_security.consumed_assertions
  OWNER TO chatforia_staff_owner;

REVOKE ALL ON ALL TABLES IN SCHEMA staff_security
  FROM PUBLIC, chatforia_dev;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA staff_security
  FROM PUBLIC, chatforia_dev;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA staff_security
  FROM PUBLIC, chatforia_dev;

ALTER DEFAULT PRIVILEGES
  FOR ROLE chatforia_staff_owner
  IN SCHEMA staff_security
  REVOKE ALL ON TABLES FROM PUBLIC;

ALTER DEFAULT PRIVILEGES
  FOR ROLE chatforia_staff_owner
  IN SCHEMA staff_security
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
