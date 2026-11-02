# Staff security release and controlled rollout preparation

Status: HOLD. Local engineering and isolated QA only. No staging or production
migration, deployment, operator provisioning, staff grant, push, or rollout has
been authorized or performed as part of this work.

## Release contents

The existing checkpoint supplies protected founder identity, staff delegation,
revocation, immutable staff history, signed single-use assertions and session
version invalidation. Pending migrations, in order:

1. `20261102090000_protect_staff_user_identity`: protects active and former staff,
   founder and global administrator identities, credentials, deletion and ADMIN
   insertion. Existing checkpoint migration is retained.
2. `20261102091000_runtime_role_permissions`: preserves ordinary Prisma CRUD,
   explicitly removes broad User UPDATE, excludes primary key/global role updates,
   and guards privileged reset, verification and recovery-code records.
3. `20261102092000_protected_credential_recovery`: independent approval and execution
   by different database login identities, approval bound to target, action and
   exact credential hash, ten-minute maximum lifetime, atomic consumption,
   session invalidation and mandatory append-only recovery audit.
4. `20261102093000_protected_mfa_login`: permits domain-separated signed login-token
   mutations without allowing runtime SQL credentials to forge privileged MFA
   challenges or recovery-code claims. Expiries use UTC to match Prisma.

Two independent flags default off. `STAFF_SECURITY_ENABLED=true` enables signed
MFA writes and startup database/configuration validation.
`STAFF_DASHBOARD_ENABLED=true` additionally exposes `/staff` APIs and the client
`/staff` dashboard. Turning off only the dashboard flag closes staff management
while keeping protected sign-in operational.

In production, enabling the dashboard also requires `STAFF_DASHBOARD_USER_IDS`,
a comma-separated allowlist of at most 200 positive user IDs. Missing or invalid
cohorts fail startup and deny requests. The cohort never grants RBAC permissions.
The checked-in `runtime.env.example` leaves both flags disabled and the cohort
empty. No production cohort has been selected or enabled.

`migration-manifest.json` records the four reviewed SQL checksums.
`npm run verify:staff-release` verifies that manifest and the disabled template
without contacting any database. Startup also confirms the signing key against
the protected database key through a read-only, domain-separated HMAC check.

## Required decisions and preparation before a deployment approval

The release owner must record the exact reviewed commit and migration checksums,
verified target database identity, backup/restore rehearsal reference, named DBA,
separate recovery approver and executor, incident owner, canary cohort and an
explicit deployment approval. These fields intentionally remain unassigned.

The DBA must provision `chatforia_staff_owner`, `chatforia_recovery_issuer`, and
`chatforia_recovery_executor` as NOLOGIN, non-superuser, non-CREATEROLE,
non-CREATEDB, non-BYPASSRLS roles. Runtime is `chatforia_dev`; it must have no
membership in these roles, no schema/table ownership and no ability to alter
security triggers. Give issuer and executor membership to separate operator
logins. Neither login may hold both memberships or inherit security-owner
privileges. Review transitive role memberships as well as direct memberships.
Migrations intentionally fail when prerequisite role boundaries are unsafe.
No role passwords belong in source control or command arguments.

Provision distinct random JWT and staff assertion keys (at least 32 bytes each)
and a 32-byte base64 encryption key through the secret manager. Match the staff
assertion key to the protected database verification key through the existing
DBA provisioning process; the runtime cannot read or replace that key. Keep the
encryption key stable for existing MFA secrets. Rehearse key rotation and
rollback in an isolated environment. Never dump secrets or assertions into logs.

Drain writes and authentication traffic while installing the complete migration
set: applying the identity guard without compatible MFA code creates a staff
login outage. Migration credentials must never be used by the application.
Enable the security flag only with the complete compatible schema and keys.
Startup must pass `assertStaffRuntimeReady` before listeners or jobs start.

## Recovery procedure prepared for authorized operators

Public password-reset requests return the same generic success for protected
accounts without issuing a reset token. Existing ordinary reset tokens cannot
write protected credentials. Self-service credential/MFA changes for protected
accounts are intentionally blocked by the database and use this operator path.

Verify the account owner through the organization's approved independent identity
process. Record the incident reference and reason outside the application.
For PASSWORD, securely prepare a bcrypt hash with cost 10–15. For MFA_REPLACE,
prepare an AES-256-GCM secret compatible with `secretBox.js`, securely enroll the
owner's authenticator and verify a code before approving the replacement.
Recovery replaces MFA while keeping it enabled; it never creates a password-only
privileged session. Losing both password and MFA requires two separate approvals.

Use a fresh 32-byte random token transported through a secure operator channel.
As the issuer login, insert only token SHA-256, target ID, action, SHA-256 of the
exact replacement value encoded as UTF-8, and expiry into
`staff_security.credential_recovery_approval`. `approved_by` is assigned from
`session_user`; issuer cannot override it. Executor uses parameterized
`staff_security.execute_credential_recovery(token, targetId, action, value, reason)`
from a different login. Do not put token, replacement value or database credentials
on a command line or in tickets. Approval expires within ten minutes and is
single-use. Review the recovery event and incremented token version, then verify
old sessions, challenges and reset links fail. No operator procedure was executed
outside rollback-only QA during this project.

## Canary plan (prepared, not started)

1. Obtain explicit approval for the named environment, reviewed revision and
   migration set. Re-run the acceptance suite and isolated restore rehearsal.
2. Rehearse deployment, ordinary login/reset, staff password/MFA login, backup-code
   login, recovery, grant, revoke, report resolution and kill switch in staging.
   No live operator identities or production data may be copied into QA.
3. After a separate production approval, drain writes, take the verified backup,
   install reviewed migrations with DBA credentials and deploy compatible code
   with security enabled and dashboard disabled. Validate runtime startup and
   ordinary/staff sign-in before admitting traffic.
4. Limit access to named canary staff by existing protected assignments. Enable
   the dashboard only after canary authorization, then verify direct API denials,
   profile boundaries, current-session enforcement and audit records.
5. Observe for at least one staffed operating window before expanding. The release
   owner must record actual error rates, latency, auth success, denial counts,
   audit completeness and recovery outcomes. Do not infer approval from elapsed time.

Stop expansion immediately on any unauthorized grant, audit mismatch, successful
replay, missing session invalidation, recovery operator overlap, privilege drift,
or failed staff/ordinary authentication. Stop on sustained new 5xx errors above
1% or p95 staff API latency above twice the measured pre-rollout baseline over
five minutes. Assign alert routing and baseline measurements before rollout.

## Containment and rollback

Before a future rollout, assign a DBA-owned retention job for expired
`mfa_login_assertions` (only rows expired for at least one day may be removed).
Expired assertions still fail signature-claim validation after pruning. Retain
recovery events and staff audit history under the organization's audit policy;
never prune live approvals or assertions. No retention job is enabled here.

First disable `STAFF_DASHBOARD_ENABLED` and restart compatible application
instances. Keep `STAFF_SECURITY_ENABLED=true` and keep all security restrictions,
audits and anti-replay records. Revoke affected staff through the protected
service from a current authorized session and validate token invalidation.
If the protected service itself is suspect, stop traffic and use the incident
DBA procedure with explicit authorization. Disabling authentication security or
removing identity triggers is not a rollback strategy.

Roll application code back only to a revision compatible with these migrations
and signed MFA writes. The original checkpoint is not compatible with the new
identity/token restrictions. Preserve the verification/encryption keys, protected
schema and mandatory audit history. Database restore is a separate incident
operation requiring explicit approval and a verified backup; it must account for
post-backup sessions, approvals, assertions and audit events. No automatic down
migration, table drop, token-version decrease or production restore is provided.

## Approval record to complete later

| Field                                               | Status                         |
| --------------------------------------------------- | ------------------------------ |
| Reviewed revision and migration hashes              | Pending reviewer selection     |
| Target database/environment                         | Pending explicit authorization |
| DBA and independent recovery operators              | Pending assignment             |
| Restore rehearsal evidence and recovery time        | Pending staging rehearsal      |
| Canary identities, observation owner, alert routing | Pending assignment             |
| Production deployment approval                      | NOT GRANTED                    |
| Controlled rollout start approval                   | NOT GRANTED                    |
