# PR #293 deployment procedure — prepared, not executed

Decision: **GO for code review; NO-GO for deployment with the current target
configuration/history and remaining evidence gaps.** Authorized read-only SSH,
catalog and configuration inspection is complete to the available account-access
boundary. No target has been modified, restarted or migrated.
See [release-plan.md](release-plan.md) for the narrowly scoped remaining gates.
The ordered target-specific actions, impact, verification and rollback for each
observed blocker are in [remediation-plan.md](remediation-plan.md). Resolve its
Priority 0 migration provenance stop before scheduling this procedure.
Run commands below only after separate authorization for the exact environment.
They are instructions, not authorization. Never run the QA fixture bootstrap on
an existing database.

## Reviewed deployment boundary

Inspected main `a66c693a6cc6a209049a15fa923d9743ffafeeb4` and this branch have
two deployment workflows, both `workflow_dispatch` only. The sole active PR
workflow runs tests/builds; no `workflow_run`, `workflow_call`, push, schedule or
repository-dispatch deployment chain exists. `.disabled` files do not execute.
Webhooks are empty per the owner. No direct deployment polling was found in the
inspected Droplet cron/systemd locations; external automation is not ruled out.
Neither workflow was dispatched. The two deployment workflow blobs on this main
revision match the prior inspected versions; its PR verification workflow remains
test/build only despite an outdated comment about push-to-main deployment.

**Do not use the existing backend workflow for this first staff-security
release.** It resets to moving `origin/main`, installs with `npm install`, runs
migrations using the process environment, then reloads PM2. It neither fences
traffic nor prepares restricted roles/keys nor separates migration credentials.
The frontend workflow independently builds a selected ref and replaces live
assets; it provides no paired release/rollback archive. These are existing
workflow limitations, not permission to change a server. Use the controlled,
SHA-pinned procedure below under a future approval, or separately implement an
equivalent approved deployment workflow. No live workflow was broadened here.

The branch adds **18** migrations to the **141** pre-PR migrations, not only the
last four. [deployment-migrations.json](deployment-migrations.json) records all
18 ordered hashes. The original four hashes in migration-manifest.json remain
unchanged. `npm run verify:staff-release` checks both manifests. The new populated
upgrade rehearsal applies 141, seeds synthetic ordinary/admin users, then applies
18 under a non-superuser executor. It verifies preservation and effective
post-upgrade restrictions. It does not certify DigitalOcean permissions or timing.

## 1. Select and prepare the release without touching the target

Record the reviewed full commit SHA, final successful PR check URL, all 18 SQL
hashes, release/incident owners and change window. Build a separate release
directory/artifact from that SHA using Node 22 and the committed lockfile:

```sh
npm ci
node node_modules/prisma/build/index.js generate --schema=server/prisma/schema.prisma
npm run verify:staff-release
npm run -w client build
```

Use the approved build configuration with no production DB connection; do not
include `.env`, OAuth credentials, uploads or secret files in the artifact.
Record artifact digests and preserve the previous frontend artifact. Retain the
approved new backend artifact as the first migration-compatible recovery image:
**pre-PR main is not a valid post-migration backend rollback**. The synthetic
test validates containment configuration, not a deployed process/image rollback.
Use the [observed inventory](infrastructure-inspection.md), then revalidate its
paths/processes against the approved change window. Cloudflare's selected frontend
origin remains unverified; both hosts have frontend virtual-host configuration.

## 2. Target preflight and recovery preparation

An authorized operator must first identify the exact database name/endpoint,
PostgreSQL version, TLS CA and verified-host policy, database/schema/table owners,
role graph (including SET membership), installed pgcrypto namespace/owner,
migration ledger, all app/job instances, proxy/cookie topology and deployment
automation. Supply metadata only, no URLs with passwords, keys or user records.
The local verifier supports tested PostgreSQL 16 and 18 baselines; another major
version or migration history is a review/isolated rehearsal gate, not an override
switch. The target is now verified PG18.6/defaultdb with runtime doadmin; local
PG18.3 populated upgrade passes. All four prerequisite roles and staff_security
are absent; pgcrypto 1.4 is available but not installed. Managed extension
installation/ownership capability has not been exercised.

**Stop on the known baseline drift before planning a migration window.** Four
active migration checksums differ from current repository/deployed files; see
the exact names and provenance investigation in the inspection record. A limited
catalog comparison has no unexplained structural differences, but cannot certify
the applied SQL. Recover trusted applied artifacts or obtain a separately reviewed
reconciliation plan. Never edit `_prisma_migrations`, run `migrate resolve`, rewrite
old SQL or relax preflight merely to turn the check green.

Current runtime doadmin owns public objects and has CREATEROLE/CREATEDB/REPLICATION/
BYPASSRLS. Prepare a distinct restricted runtime identity; keep privileged DBA
ownership/credentials separate rather than transferring every object or changing
provider-managed roles. The root API can access existing privileged env backups
and PM2 state: plan an OS/credential boundary as well as the DATABASE_URL change.
Before public staff traffic, also plan an independent SESSION_SECRET (absent in
inspected sources with a deployed literal fallback), new staff signing key,
verified web-upstream/database TLS identity and a verified proxy-only ingress
policy. These are future approved changes, not actions performed by inspection.

Require a recoverable pre-change snapshot plus logical database export and
password-free role/ownership/grantor metadata, with encrypted restricted custody,
digests, time point, retention, restore destination and measured RPO/RTO. Preserve
JWT/session, staff assertion and existing MFA encryption key versions separately
in the actual secret store. Verify independent access to that recovery material.
Local restore/reconciliation already passed; provider restore success and
independent key custody have not. Owner-reported PITR/latest-transaction recovery
offers seven days into a new cluster. Same-host root-owned 0600 key copies match
but are not independent recovery. A second database on production chatforia-db is not an
isolated rehearsal because roles are cluster-wide. No paid fallback is authorized.

Before the migration window, name separate recovery issuer/executor humans and
their distinct login identities; neither may also be the runtime or security
owner, and neither may hold both recovery memberships (including transitively).
Name verified founder, initial CTO/ACCESS_ADMIN and canary account IDs separately;
global ADMIN is not a staff assignment. Check existing protected administrators
have usable MFA and previously linked provider identities. Link providers and
enroll ordinary future staff **before** protection; the new identity trigger
intentionally blocks later self-service credential/provider changes. Do not
infer founder identity from a display name/email or promote a runtime identity.

## 3. Fence, back up, and prepare the privileged boundary

Under explicit change approval: close public authentication/mutation ingress,
drain requests, stop all API instances and background writers/issuers, and fence
operator writes. Record the cutover. Take/verify the consistent pre-change backup
and ensure the restore destination is independent before proceeding.

The separate DBA executor, never the application connection, must provision or
verify these prerequisites without silently rewriting an unsafe existing role:

| Role | Required boundary |
| --- | --- |
| `chatforia_dev` | LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS; no object/schema ownership or privileged memberships |
| `chatforia_staff_owner` | NOLOGIN plus all restrictions above; owns `staff_security`; only DBA has scoped SET authority for ownership transfer |
| `chatforia_recovery_issuer`, `chatforia_recovery_executor` | Separate NOLOGIN restricted roles; only the corresponding independent operator receives membership |

`server/scripts/staff-access-bootstrap-role.sql` is the reviewed owner/schema
bootstrap, not a complete production role-provisioning script. The CI bootstrap
is expressly forbidden here. Any existing unsafe runtime ownership/membership
requires a separately reviewed ownership/ACL transition; do not grant superuser
or use REASSIGN OWNED/CASCADE as a shortcut. PostgreSQL 16 grantor dependencies
must survive; keep the migration executor offline rather than blindly revoking
membership that authored grants.

The prepared [production role script](../../server/scripts/staff-production-prerequisite-roles.sql)
is a guarded, atomic no-password role creation template for the inspected
`defaultdb`; it creates no grants, schema or extension. Use only after the four
baseline checksum mismatches are independently resolved and a separate DBA
approves its exact target/permissions. The DBA must separately give only the
migration executor scoped SET membership in the owner role and then run the
schema bootstrap. The local static guard test passed; its fresh PG18 execution
test is pending because macOS could not allocate a new shared-memory segment
for `initdb` while the existing preview cluster was preserved. This does not
establish DigitalOcean managed-role compatibility.

If pgcrypto already exists outside `staff_security`, **stop before migrations**.
`CREATE EXTENSION IF NOT EXISTS ... WITH SCHEMA` does not relocate it. Do not
move a shared production extension based on a passing local experiment; obtain a
dependency review and an isolated target-specific plan first.

Load the approved DBA connection through protected process environment (no CLI
passwords, shell tracing or dotenv dumps). Set `STAFF_EXPECTED_DATABASE` from the
independently verified inventory. From the pinned release directory run:

```sh
node server/scripts/staff-deployment-preflight.mjs --before-migrations
node node_modules/prisma/build/index.js migrate status --schema=server/prisma/schema.prisma
```

The first command is transactionally read-only: it verifies the role/schema/
pgcrypto prerequisites and exact checksums of all 141 completed baseline
migrations. It rejects wrong identity, failed/partial/extra staff history and
unsafe ownership. `migrate status` should report exactly the reviewed 18 pending
migrations (pending status may be nonzero); inspect the set, not just its exit
code. No preflight success authorizes migration. Do not use the initial-release
preflight on an already-upgraded database and interpret its rejection as drift.

## 4. Apply the compatible unit, still fenced

Only after every preceding gate and explicit migration approval:

```sh
node node_modules/prisma/build/index.js migrate deploy --schema=server/prisma/schema.prisma
node node_modules/prisma/build/index.js migrate status --schema=server/prisma/schema.prisma
```

Require all 159 migrations finished and the exact reviewed checksums; preserve
sanitized execution records. On any failure leave traffic closed. Prisma SQL
files are not an atomic 18-file transaction: inspect partial DDL/ledger before
any repair; never automatically mark a failed migration resolved or retry a
different SQL file under the same name.

Provision a fresh independent staff signing key through the protected DBA/secret
store channel. Parameterized insertion into `staff_security.assertion_secrets`
must use `id=1`, positive `key_version`, and UTF-8 bytes of the **same string** as
`STAFF_ACCESS_SIGNING_SECRET`; do not decode a hex-looking string in only one
location. Never print the key, interpolate it into shell SQL, or replace an
existing row without a separate rotation plan. Preserve the existing
`APP_ENC_KEY` (32 decoded base64 bytes), JWT keys and OAuth configuration unless
separately approved rotation is required. Provision the missing independent
SESSION_SECRET with at least 32 random bytes; account for invalidation of sessions
signed with the existing fallback during the fenced cutover. JWT, session and
staff keys must be different. JWT and staff keys must each be at least 32 bytes.

Initialize founder ownership and the initial delegation authority only after
independent human identity approval. In a reviewed DBA transaction acquire
advisory lock `(73421,1)`, lock the named users in ascending ID order, verify the
founder singleton is absent (otherwise compare/stop), insert its verified
reference, and seed only the explicitly approved initial assignments. Use the
security owner for staff rows/events/audits, append the bootstrap event/reason
and audit atomically, and increment affected session versions. The founder may
not act in delegated staff management. Never run synthetic fixture SQL or the
old initial-ADMIN role-upgrade script after these restrictions. Missing verified
IDs/approval blocks bootstrap and dashboard activation, not an invitation to
invent users. Later grants/revocations use the signed protected service.

## 5. Start compatible runtime privately and verify

Remove/isolate DBA credentials from every app/job environment source, saved PM2
state and readable backup file under the approved custody/OS-access plan. Merely
changing the active DATABASE_URL does not separate credentials from a root app.
Load only the restricted
runtime connection (correct TLS verification), shared production keys and Redis
configuration. Set `NODE_ENV=production`, `STAFF_SECURITY_ENABLED=true`, and
`STAFF_DASHBOARD_ENABLED=false`. The both-false example is a preparation template,
**not a valid authentication configuration after migration**. Set the actual
approved cookie/domain/origin/proxy settings; do not add local test origins.

```sh
node server/scripts/staff-deployment-preflight.mjs --runtime
```

This transactionally read-only command requires security enabled and verifies
the runtime privilege/trigger boundary and a non-disclosing signing-key match.
Start the pinned API privately with these same environment values. Startup runs
the same readiness check before listeners/jobs. With multiple processes ensure
every process has the same keys/version and restricted connection; no old/new
code overlap across the migration boundary. Keep external traffic fenced and
coordinate background jobs rather than enabling duplicate writers. Resolve the
observed enabled-but-inactive PM2 systemd unit in the approved process plan and
verify the compatible process recovery path; do not assume a running daemon
proves reboot recovery. No such restart/rollback has been tested on the target.

Verify deployed HTTPS Secure/HttpOnly/SameSite/domain cookie issuance/clearing,
trusted proxy behavior, Google password/MFA path, pre-MFA denial, current staff
and Admin boundaries, correct CSRF success and wrong/missing CSRF denial, logout
then session/staff/admin denial. This is a short **deployment-boundary** smoke,
not a repeat of the completed component/browser matrix. The current CORS fix
adds only development localhost:5002; production origin behavior is unchanged.
Verify ordinary login/reset still works and protected reset remains generic with
no issued token. Any deployed provider already serving affected MFA users must
receive a smoke check; do not call mocked Apple/mobile tests real validation.

Publish the matching frontend artifact atomically with the approved runtime
`env.js` and SPA routing; preserve uploads, environment files and rollback
artifact. Use observed paths/configuration from the inventory, not the existing
unpaired rsync workflow. Test through the proxy before public admission.

## 6. Canary and stop conditions

After explicit canary approval, set `STAFF_DASHBOARD_ENABLED=true` with the named
`STAFF_DASHBOARD_USER_IDS` (1–200 positive IDs). The allowlist does not grant
permissions and does not gate the separate global Admin Users APIs. Verify
current MFA, active profile, authoritative View/Edit permissions, one atomic
audit for a permitted preference change and session invalidation on revocation.
Confirm alarm delivery to named operators without credentials/assertions in logs.
Open only the approved traffic/cohort; observe a staffed operating window.

Abort before opening on any unknown target/role/history, missing backup/key,
failed migration/readiness, missing operator separation/founder identity,
nonfunctional MFA, unsafe cookie/CSRF result or absent incident owner. Stop
expansion immediately for unauthorized access, successful replay, missing audit,
revocation failure or recovery overlap. Also stop for new 5xx above 1% or staff
API p95 above twice the recorded pre-rollout baseline for five minutes. Record
those baselines before opening; do not invent measurements from local timings.

## 7. Containment and rollback

1. Disable only `STAFF_DASHBOARD_ENABLED`; retain security=true, keys, DB
   restrictions and audit/replay state. Reload compatible processes with the
   changed environment; verify staff routes close. This does **not** close
   global Admin APIs or undo migrations. Fence those routes/all ingress if the
   incident includes them. Revoke affected staff using the protected service if
   trustworthy; otherwise stop traffic and involve the incident DBA.
2. Restore the prior frontend artifact if needed. For backend failure, redeploy
   the approved migration-compatible recovery artifact, validate its exact
   environment/readiness, and repeat the small private deployment smoke. There
   is no certified pre-PR backend fallback. If no compatible artifact works,
   remain fenced and repair forward or approve incident restore.
3. Never down-migrate, delete audit/replay tables, lower token versions, bypass
   triggers or set security=false. Do not revert to old runtime/database
   credentials. Preserve logs and partial migration evidence without secrets.
4. Database restore is a separate explicit incident approval, into an independent
   empty target with matching roles/ACLs/sequences and recoverable keys. Reconcile
   every post-backup revocation, session floor, consumed approval/assertion and
   audit event before reopening. Follow [older-snapshot-recovery.md](older-snapshot-recovery.md).
   Its QA ledger/importer is not an authorized production repair CLI. Without
   complete trusted post-backup history, keep access closed and require a
   separately approved recovery/quarantine policy; backup credentials/grants
   must never silently become authoritative again.

Expired MFA assertion retention can be scheduled later by the DBA (only records
expired at least one day); this is capacity housekeeping, not permission to
prune live approvals or audit history and not a blocker for the initial canary.

## Protected credential recovery — approved operators only

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
