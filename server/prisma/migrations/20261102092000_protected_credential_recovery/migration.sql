
-- Protected credential recovery.
-- Requires two independently provisioned NOLOGIN roles:
-- chatforia_recovery_issuer and chatforia_recovery_executor.
-- Memberships must be granted to separate authorized operators
-- by the database administrator, never to chatforia_dev.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chatforia_recovery_issuer')
     OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chatforia_recovery_executor') THEN
    RAISE EXCEPTION 'DBA must provision separate NOLOGIN recovery roles before migration';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN (
    'chatforia_recovery_issuer', 'chatforia_recovery_executor', 'chatforia_staff_owner'
  ) AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls))
  OR pg_has_role('chatforia_dev', 'chatforia_recovery_issuer', 'MEMBER')
  OR pg_has_role('chatforia_dev', 'chatforia_recovery_executor', 'MEMBER') THEN
    RAISE EXCEPTION 'Unsafe recovery role configuration';
  END IF;
END;
$roles$;

-- Recovery operators may access only explicitly granted objects.
GRANT USAGE ON SCHEMA staff_security
TO chatforia_recovery_issuer, chatforia_recovery_executor;

CREATE TABLE staff_security.credential_recovery_approval (
  token_hash BYTEA PRIMARY KEY,
  target_user_id INTEGER NOT NULL,
  value_hash BYTEA NOT NULL CHECK (octet_length(value_hash) = 32),
  action TEXT NOT NULL CHECK (
    action IN ('PASSWORD', 'MFA_REPLACE')
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_by TEXT NOT NULL DEFAULT session_user,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT recovery_approval_lifetime CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '10 minutes'
  )
);

ALTER TABLE staff_security.credential_recovery_approval
OWNER TO chatforia_staff_owner;

REVOKE ALL ON staff_security.credential_recovery_approval
FROM PUBLIC, chatforia_dev;

GRANT INSERT (
  token_hash, target_user_id, value_hash, action, expires_at
) ON staff_security.credential_recovery_approval
TO chatforia_recovery_issuer;

CREATE TABLE staff_security.credential_recovery_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_user_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('PASSWORD', 'MFA_REPLACE')),
  approved_by TEXT NOT NULL,
  executed_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE staff_security.credential_recovery_event
OWNER TO chatforia_staff_owner;

REVOKE ALL ON staff_security.credential_recovery_event
FROM PUBLIC, chatforia_dev;

CREATE FUNCTION staff_security.execute_credential_recovery(
  p_token TEXT,
  p_target_id INTEGER,
  p_action TEXT,
  p_value TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, staff_security, pg_temp
AS $function$
DECLARE
  v_approval RECORD;
  v_user RECORD;
BEGIN
  IF p_token IS NULL
     OR p_token !~ '^[a-f0-9]{64}$'
     OR p_target_id IS NULL OR p_target_id <= 0
     OR p_action IS NULL OR p_action NOT IN ('PASSWORD', 'MFA_REPLACE')
     OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 15 AND 500
  THEN
    RAISE EXCEPTION 'Invalid protected recovery request';
  END IF;

  -- Match staff-management lock order to serialize recovery with delegation.
  PERFORM pg_advisory_xact_lock(73421, 1);
  -- Lock target before consuming approval.
  SELECT * INTO v_user
  FROM public."User"
  WHERE "id" = p_target_id
  FOR UPDATE;

  IF NOT FOUND OR v_user."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Recovery target unavailable';
  END IF;

  IF NOT (
    v_user."role" = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM public."FounderOwnership"
      WHERE "userId" = p_target_id
    )
    OR EXISTS (
      SELECT 1 FROM public."StaffAssignment"
      WHERE "userId" = p_target_id
    )
  ) THEN
    RAISE EXCEPTION 'Target is not a protected identity';
  END IF;

  UPDATE staff_security.credential_recovery_approval
  SET consumed_at = clock_timestamp()
  WHERE token_hash = sha256(decode(p_token, 'hex'))
    AND target_user_id = p_target_id
    AND action = p_action
    AND value_hash = sha256(convert_to(coalesce(p_value, ''), 'UTF8'))
    AND consumed_at IS NULL
    AND expires_at > clock_timestamp()
  RETURNING approved_by INTO v_approval;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery approval invalid, expired or used';
  END IF;

  -- Session authorization identifies the actual database login,
  -- rather than the SECURITY DEFINER function owner.
  IF v_approval.approved_by = session_user THEN
    RAISE EXCEPTION
      'Recovery approval and execution require separate operators'
      USING ERRCODE = '42501';
  END IF;

  IF p_action = 'PASSWORD' THEN
    IF p_value IS NULL
       OR p_value !~ '^\$2[aby]\$(1[0-5])\$[./A-Za-z0-9]{53}$' THEN
      RAISE EXCEPTION 'Invalid password hash';
    END IF;

    UPDATE public."User"
    SET "passwordHash" = p_value,
        "tokenVersion" = "tokenVersion" + 1
    WHERE "id" = p_target_id;

  ELSIF p_action = 'MFA_REPLACE' THEN
    IF p_value IS NULL OR length(p_value) NOT BETWEEN 40 AND 4096 THEN
      RAISE EXCEPTION 'Encrypted MFA secret required';
    END IF;
    UPDATE public."User"
    SET "twoFactorEnabled" = true,
        "totpSecretEnc" = p_value,
        "twoFactorEnrolledAt" = clock_timestamp(),
        "tokenVersion" = "tokenVersion" + 1
    WHERE "id" = p_target_id;

    -- Invalidate pending MFA enrollment and recovery challenges.
    UPDATE public."VerificationToken"
    SET "usedAt" = clock_timestamp()
    WHERE "userId" = p_target_id
      AND starts_with("type", 'mfa_')
      AND "usedAt" IS NULL;

    DELETE FROM public."TwoFactorRecoveryCode"
    WHERE "userId" = p_target_id;

  END IF;

  -- Every recovery invalidates outstanding reset and verification tokens.
  UPDATE public."PasswordResetToken" SET "usedAt" = clock_timestamp()
  WHERE "userId" = p_target_id AND "usedAt" IS NULL;
  UPDATE public."VerificationToken" SET "usedAt" = clock_timestamp()
  WHERE "userId" = p_target_id AND "usedAt" IS NULL;

  INSERT INTO staff_security.credential_recovery_event (
    target_user_id, action, approved_by, executed_by, reason
  ) VALUES (
    p_target_id, p_action, v_approval.approved_by,
    session_user, btrim(p_reason)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'targetUserId', p_target_id,
    'action', p_action,
    'sessionsRevoked', true
  );
END;
$function$;

ALTER FUNCTION staff_security.execute_credential_recovery(
  TEXT, INTEGER, TEXT, TEXT, TEXT
) OWNER TO chatforia_staff_owner;

REVOKE ALL ON FUNCTION staff_security.execute_credential_recovery(
  TEXT, INTEGER, TEXT, TEXT, TEXT
) FROM PUBLIC, chatforia_dev;

GRANT EXECUTE ON FUNCTION staff_security.execute_credential_recovery(
  TEXT, INTEGER, TEXT, TEXT, TEXT
) TO chatforia_recovery_executor;
