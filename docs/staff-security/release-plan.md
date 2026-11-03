# Staff security release and controlled rollout preparation

Status: HOLD. Draft PR [#293](https://github.com/nortonjulian/chatforia/pull/293)
was published with explicit approval. No staging or production migration,
deployment, production operator provisioning, staff grant or rollout has been
authorized or performed. Existing Droplets and chatforia-db remain untouched.

## Completed local follow-up

The follow-up passes 269 server unit/API tests, 20 UI component tests, 17 real
Chrome browser checks and six cross-cluster restore/security checks (26 rehearsal
checks including three source/setup/drift checks). Both fresh clusters stopped; no
existing database or production dataset was used. Successful restored MFA and new
token writes were included. See `acceptance.md`, `lint-investigation.md` and
`local-rehearsal.md`. These results do not enable rollout or waive the gates below.

Root lint still fails with 384 errors and 2,609 warnings; the same-rule comparison
finds no branch-introduced findings. Remaining source/configuration debt needs
separate repository ownership before claiming a green full CI gate.

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

The DBA must verify managed-service ownership/SET ROLE and pgcrypto compatibility
on the new empty staging cluster first. The local non-superuser executor
rehearsal passes, but does not certify DigitalOcean. Owner bootstrap rejects an
unsafe existing role instead of performing superuser-only role normalization.
A separate DBA executor needs ownership-transfer authority; never grant it to
the application. Preserve PostgreSQL 16 grantor provenance: do not CASCADE-revoke
executor membership. Keep DBA credentials sealed offline and review dependencies
before changing those memberships.

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
old sessions, challenges and reset links fail. Operator procedures were exercised only with synthetic identities in rollback-only
QA and newly created disposable clusters, never in staging or production.

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

## Exact staging/manual checks still required

These checks require a separately authorized staging environment and synthetic
data. No staging or production changes are authorized by this document.

1. **Full application routing and sign-in:** exercise `/admin/users` and `/staff`
   through the real application shell, UserContext bootstrap, password/TOTP,
   backup-code and configured OAuth entry points. The local harness mounted real
   components/APIs directly with synthetic signed session cookies. Verify a
   signed-out visitor and a non-MFA or stale session cannot display protected
   content; a genuine current session opens only its authorized controls.
2. **View/Edit through the hosted app:** View the selected current user; Edit and
   save only the four allowed preferences; cancel without a write; provoke invalid
   values, a stale-value conflict and session loss while the form is open. Verify
   refreshed committed values and exactly one audit per actual successful change.
   Attempt credential/role/identity fields and protected current/former staff,
   founder, system and administrator targets; expect rejection and no mutation.
   Confirm legacy `/role`, `/flags`, `/ban`, `/unban` and delete handlers remain
   unmounted under the Users API.
3. **Actual HTTPS hosting boundary:** validate Secure/HttpOnly/SameSite/domain
   cookies, proxy settings and the site's real API origin/CORS allowlist. Correct
   browser CSRF headers must work; missing/wrong CSRF and cookie-plus-Bearer bypass
   must fail. The local browser used same-origin loopback HTTP, not the hosted
   multi-origin topology.
4. **Cross-engine and keyboard/mobile behavior:** repeat View/Edit, native-dialog
   close/cancel/focus (Chrome Tab/Shift+Tab/Escape now verified locally), validation, profile selection and session-loss flows in
   Firefox on a supported renderer host and Safari/WebKit, including a real mobile
   viewport/device. Installed local Firefox failed before page creation; Chrome
   desktop and a 390×844 viewport passed. No Firefox sandbox bypass was used; Chrome used standard Playwright launch settings.
5. **Managed PostgreSQL and operator boundary:** verify the actual supported
   extension/version, owner/NOLOGIN roles, runtime memberships/ACLs/trigger status,
   migration hashes, explicit canary IDs, and startup rejection of key mismatch
   or privilege drift. Confirm issuer/executor logins are independent and neither
   overlaps the runtime/security owner. Rehearse recovery with approved identity
   verification, expiry, replay denial, session invalidation and atomic audit.
6. **Backup/key recovery and security time point:** restore a synthetic managed
   staging backup into a new empty target, including role-grantor provenance,
   ownership, ACLs, sequences, audit and replay state. Recover encryption/signing
   keys through the actual secret-manager procedure and prove positive MFA plus
   stale-session/replay denial. Record measured RPO/RTO, restore time point,
   snapshot consistency and retention evidence. The local exact-snapshot fixture
   took 1,279 ms for target initialization/restore/verification; it is not a
   capacity or operational timing guarantee.
7. **Older snapshots and post-backup security changes:** explicitly rehearse
   traffic fencing, token/assertion-key rotation or equivalent invalidation, and
   reconciliation of post-backup revocations/consumed approvals before reopening
   traffic. The local backup already contained the tested revocations; it did not
   certify restoring an older snapshot that could otherwise revive old sessions
   or lose newer audit/replay records. Do not reopen a restored service until the
   chosen time-point security policy is proved and approved.
8. **Operations and rollback:** assign the DBA, recovery operators, canary cohort,
   incident owner and alert routes. Verify auth failures, direct denials, replay
   and audit-failure alerts reach the approved operator channel without secrets.
   Measure baseline latency/error rates, rehearse the dashboard-only kill switch
   and a compatible application rollback, then observe the staffed canary window
   against the stop criteria above. Deployment and rollout require separate
   explicit approvals; elapsed time never grants approval.

## Publication and next approval boundary

Branch `feature/staff-access-rbac-20261102` is published to the verified
`nortonjulian/chatforia` origin and PR #293 targets main as a draft. Current remote
main deployment workflows are manual-only; no indirect workflow deployment chain
exists. Repository Webhooks is empty per the owner. No Render configuration is
used as deployment evidence. Droplet-side cron/polling automation was not inspected.
The existing production deployment workflows must not be dispatched for staging.

Security review fixes are committed as `fd64a584`. CI setup fix `d16ada4f` passed
run 135 (129 room/server tests, five client tests and build). The updated workflow
also requires all 269 selected staff tests, scoped lint and migration/config
verification. [Run 136](https://github.com/nortonjulian/chatforia/actions/runs/41574812500)
completed successfully at `fd64a584`: all 269 staff regressions, scoped lint,
release verifier, all migrations, 129 room/server tests, five client tests and
the production client build passed. Later documentation-only revisions still
require their own PR check result; this evidence is pinned to the tested source.
Root lint remains separately red; a passing selected workflow does not waive it.

Next: obtain explicit approval for the concrete isolated resources, budget,
domain and named operators in [staging-proposal.md](staging-proposal.md). That
proposal creates separate web/API Droplets, a new managed database and a separate
restore target, uses synthetic data and completes all eight gates above. It does
not reuse or access production resources. No resources have been provisioned.
Require security/DB review and resolve repository lint ownership before any
production release decision. Staging approval never authorizes a merge or
production migration/deployment/rollout.

## Approval record to complete later

| Field                                               | Status                                                |
| --------------------------------------------------- | ----------------------------------------------------- |
| Reviewed revision and migration hashes              | Pending reviewer selection                            |
| Target database/environment                         | Pending explicit authorization                        |
| DBA and independent recovery operators              | Pending assignment                                    |
| Restore rehearsal evidence and recovery time        | Local synthetic pass; managed staging/RPO/RTO pending |
| Canary identities, observation owner, alert routing | Pending assignment                                    |
| Production deployment approval                      | NOT GRANTED                                           |
| Controlled rollout start approval                   | NOT GRANTED                                           |
