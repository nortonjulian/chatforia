import { createHmac, randomBytes } from 'node:crypto';

import { staffCanaryIds } from './staffRollout.js';

export async function assertStaffRuntimeReady(db, env = process.env) {
  if (
    env.STAFF_DASHBOARD_ENABLED === 'true' &&
    (env.STAFF_SECURITY_ENABLED !== 'true' ||
      (env.NODE_ENV === 'production' &&
        !staffCanaryIds(env.STAFF_DASHBOARD_USER_IDS)))
  ) {
    throw new Error(
      'Staff dashboard requires security and an explicit production canary cohort'
    );
  }
  if (env.STAFF_SECURITY_ENABLED !== 'true') return;
  if (
    typeof env.STAFF_ACCESS_SIGNING_SECRET !== 'string' ||
    Buffer.byteLength(env.STAFF_ACCESS_SIGNING_SECRET) < 32 ||
    typeof env.JWT_SECRET !== 'string' ||
    Buffer.byteLength(env.JWT_SECRET) < 32 ||
    env.JWT_SECRET === env.STAFF_ACCESS_SIGNING_SECRET ||
    Buffer.from(env.APP_ENC_KEY || '', 'base64').length !== 32
  ) {
    throw new Error(
      'Staff security requires separate signing keys and a valid encryption key'
    );
  }
  const rows = await db.$queryRaw`
    SELECT current_user = 'chatforia_dev'
      AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user
        AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls))
      AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
      AND NOT has_schema_privilege(current_user, 'staff_security', 'CREATE')
      AND NOT has_table_privilege(current_user, 'public."User"', 'TRUNCATE,TRIGGER')
      AND NOT has_table_privilege(current_user, 'public."VerificationToken"', 'TRUNCATE,TRIGGER')
      AND NOT has_table_privilege(current_user, 'public."PasswordResetToken"', 'TRUNCATE,TRIGGER')
      AND NOT has_table_privilege(current_user, 'public."TwoFactorRecoveryCode"', 'TRUNCATE,TRIGGER')
      AND NOT pg_has_role(current_user, 'chatforia_staff_owner', 'MEMBER')
      AND NOT pg_has_role(current_user, 'chatforia_recovery_issuer', 'MEMBER')
      AND NOT pg_has_role(current_user, 'chatforia_recovery_executor', 'MEMBER')
      AND NOT has_column_privilege(current_user, 'public."User"', 'role', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public."User"', 'id', 'UPDATE')
      AND NOT has_table_privilege(current_user, 'public."StaffAssignment"', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
      AND NOT has_table_privilege(current_user, 'public."StaffAccessEvent"', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
      AND NOT has_table_privilege(current_user, 'public."FounderOwnership"', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
      AND NOT has_table_privilege(current_user, 'public."AuditLog"', 'UPDATE,DELETE,TRUNCATE,TRIGGER')
      AND NOT has_function_privilege(current_user, 'staff_security.execute_credential_recovery(text,integer,text,text,text)', 'EXECUTE')
      AND NOT has_function_privilege(current_user, 'staff_security.verify_staff_assertion(text)', 'EXECUTE')
      AND NOT has_function_privilege(current_user, 'staff_security.consume_staff_assertion(text)', 'EXECUTE')
      AND has_function_privilege(current_user, 'staff_security.mfa_login_write(text,text)', 'EXECUTE')
      AND has_function_privilege(current_user, 'staff_security.grant_or_change_staff_access(text,text)', 'EXECUTE')
      AND has_function_privilege(current_user, 'staff_security.revoke_staff_access(text,text)', 'EXECUTE')
      AND (SELECT count(*) = 3 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'
        AND tgname IN ('protect_staff_user_identity_insert','protect_staff_user_identity_update','protect_staff_user_identity_delete'))
      AND (SELECT count(*) = 3 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'
        AND tgname = 'protect_privileged_auth_token_dml')
      AND NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','staff_security') AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname=current_user))
      AS ready
  `;
  if (rows?.length !== 1 || rows[0]?.ready !== true)
    throw new Error('Staff runtime database boundary is not ready');
  const probe = randomBytes(32).toString('hex');
  const signature = createHmac('sha256', env.STAFF_ACCESS_SIGNING_SECRET)
    .update(`staff-readiness:${probe}`)
    .digest('hex');
  const keyCheck = await db.$queryRaw`
    SELECT staff_security.runtime_key_matches(${probe}::text, ${signature}::text) AS ready
  `;
  if (keyCheck?.[0]?.ready !== true)
    throw new Error('Staff runtime signing key does not match the database');
}
