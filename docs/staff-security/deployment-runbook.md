# PR #293 deployment procedure — prepared, not executed

**Current operational status:** [production-change-plan.md](production-change-plan.md)
supersedes stale checkpoint/status statements below. PRs #293 and #300 are merged;
the release has 141 baseline plus 19 new migrations (160 total). The owner accepted
historical uncertainty for review only; production exception activation remains blocked.
A basic hosted restore readability check passed, not exhaustive integrity or measured
RPO/RTO. The archived review package is verified locally; a final activation release
will require a new archive. No production cutover or Stage 6 admission is authorized.
The owner-provided firewall/Cloudflare evidence, read-only SSH/certificate findings
and proposed network fence are in [ingress-fencing-proposal.md](ingress-fencing-proposal.md).


Migration execution must follow [the archived package and receipt procedure](migration-release-packages.md).
The owner accepted the four-migration historical uncertainty and authorized preparation
for review; see [the acceptance record](migration-exception-review.md). PR #300 integrates
the pinned exception into package validation, but the manifest remains unapproved for
production. Separate merge and production activation decisions remain required.
Treat migration commands below as sequencing context; use the package runner for
actual execution after those gates are resolved.

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

The branch adds **19** migrations to the **141** pre-PR migrations, not only the
last four. [deployment-migrations.json](deployment-migrations.json) records all
19 ordered hashes. The original four hashes in migration-manifest.json remain
unchanged. `npm run verify:staff-release` checks both manifests. The new populated
upgrade rehearsal applies 141, seeds synthetic ordinary/admin users, then applies
19 under a non-superuser executor. It verifies preservation and effective
post-upgrade restrictions. It does not certify DigitalOcean permissions or timing.

## 1. Select and prepare the release without touching the target

Record the reviewed full commit SHA, final successful PR check URL, all 19 SQL
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

**The known baseline drift remains a production stop until activation is approved.**
Four active migration checksums differ from current repository/deployed files;
see the exact names and provenance investigation in the inspection record. The
original applied SQL could not be recovered. A limited catalog comparison has no
unexplained structural differences, but cannot certify historical data effects.
The target-bound four-pair reconciliation is prepared, tested and still inactive;
its production use requires an explicit exception activation, new reviewed
package and separate execution approval. Never edit `_prisma_migrations`, run
`migrate resolve` or rewrite old SQL to turn the check green.

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
Local restore/reconciliation and a basic hosted restore readability check passed.
Refresh backup health for the actual window. Existing `APP_ENC_KEY` now has an
[off-host Apple Passwords copy](evidence/app-enc-key-custody-20261106.json):
exact Mac readback matched the production source, and the owner reported an
iPhone full-value visual match. JWT/OAuth retrieval remains pending. This is
same-owner Apple Passwords custody, not a separate human or provider.
The [existing Twilio Auth Token](evidence/twilio-auth-token-retrieval-20261106.json)
was independently retrieved from Twilio Console and exactly matched the deployed
source; no additional copy or rotation was performed. Console-account access
remains necessary to retrieve it again.
Owner-reported PITR/latest-transaction recovery offers seven days into a new
cluster. Same-host root-owned 0600 key copies match but alone are not independent
recovery. A second database on production chatforia-db is not an isolated
rehearsal because roles are cluster-wide. No paid fallback is authorized.

Before recovery activation, verify the owner's two distinct database login
identities, separately stored credentials and separate sessions. Each login
may hold only its corresponding recovery role, with no direct or transitive
membership in the other, runtime or security-owner role. The owner accepted
the residual single-person risk; this is credential separation, not two-person
approval. Follow [sole-owner-recovery.md](sole-owner-recovery.md).
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
| `chatforia_recovery_issuer`, `chatforia_recovery_executor` | Separate NOLOGIN restricted roles; each proposed LOGIN principal may SET only its corresponding role |

`server/scripts/staff-access-bootstrap-role.sql` is the reviewed owner/schema
bootstrap, not a complete production role-provisioning script. The CI bootstrap
is expressly forbidden here. Any existing unsafe runtime ownership/membership
requires a separately reviewed ownership/ACL transition; do not grant superuser
or use REASSIGN OWNED/CASCADE as a shortcut. PostgreSQL 16 grantor dependencies
must survive; keep the migration executor offline rather than blindly revoking
membership that authored grants.

The prepared production role script creates `chatforia_dev` with `PASSWORD NULL`;
the authorized DBA must provision its separate login secret through protected
custody after creation, then verify a login as that role without displaying the
URL or granting ownership, `SET` membership or elevated flags.

The prepared [production role script](../../server/scripts/staff-production-prerequisite-roles.sql)
is a guarded, atomic no-password role creation template for the inspected
`defaultdb`; it creates no grants, schema or extension. Use only after the
four-pair target-bound reconciliation is separately approved for production,
the final package is backed up and the change-window recovery gates pass.
Exact-checksum validation remains the default; the original applied SQL is
unavailable, so the four pairs have not been independently resolved. A privileged
operator must approve the exact target/permissions, give only the migration
executor scoped SET membership in the owner role, and then run the schema
bootstrap. The static guard and disposable PostgreSQL 18.6 role
execution passed in CI 150. This does not establish DigitalOcean managed-role
compatibility.

The separate [recovery-login template](../../server/scripts/staff-recovery-operator-logins.sql)
is also prepared only. It creates password-free issuer/executor LOGIN principals
with exclusive SET membership; credentials are provisioned privately only under
separate approval after the base roles are reviewed. Its disposable PostgreSQL
18 role-graph check does not prove DigitalOcean credential custody or grant
compatibility. Do not use one DBA connection with `SET ROLE` for both recovery
steps; the recovery function checks distinct `session_user` identities.

If pgcrypto already exists outside `staff_security`, **stop before migrations**.
`CREATE EXTENSION IF NOT EXISTS ... WITH SCHEMA` does not relocate it. Do not
move a shared production extension based on a passing local experiment; obtain a
dependency review and an isolated target-specific plan first.

Load the approved DBA connection through protected process environment (no CLI
passwords, shell tracing or dotenv dumps). Set `STAFF_EXPECTED_DATABASE` from the
independently verified inventory. Run `deploy-migration-package.mjs` without
`--execute` from the pinned release and independent receipt archive. The runner
invokes the transactionally read-only role/schema/pgcrypto and ledger checks with
the explicitly approved reconciliation ID. It rejects wrong identity,
failed/partial/extra staff history, unsafe ownership, any fifth mismatch and
every changed new SQL checksum. Inspect the expected 19 pending migrations and
the archived preflight receipt. No preflight success authorizes migration. Do not
use the initial-release preflight on an already-upgraded database and interpret
its rejection as drift.

## 4. Apply the compatible unit, still fenced

Only after every preceding gate and explicit migration approval, execute the
exact reviewed archive with `deploy-migration-package.mjs --execute` as described
in [migration-release-packages.md](migration-release-packages.md). Do not run a
standalone `prisma migrate deploy` against the target: it would omit the pinned
package, target-bound reconciliation and independent attempt receipts.

Require all 160 migrations finished and the exact reviewed checksums, except
the four separately approved historical ledger/file pairs; preserve
sanitized execution records. On any failure leave traffic closed. Prisma SQL
files are not an atomic 19-file transaction: inspect partial DDL/ledger before
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
the owner's privately verified immutable User ID and an explicit bootstrap
approval. This is sole-owner verification, not a second-person sign-off. In a
reviewed privileged transaction acquire
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

The [read-only credential inspection](evidence/database-credential-cutover-inspection.json)
found **one** root-owned PM2 API process tree (npm, shell and Node children, all
inheriting `doadmin`), not a separate running database worker. The active
`npm start` script sets `DOTENV_CONFIG_PATH=.env.production` and
`DOTENV_CONFIG_OVERRIDE=true`, so `server/.env.production` is the effective
Node credential source; `/root/.pm2/dump.pm2` also saves a `doadmin` URL.
`server/.env`, repository-root `.env` and a root-owned production env backup
also contain that role. The in-process cleanup, expiry, number-lifecycle and
optional Google Play jobs share this runtime environment. Root crontab has no
active entries; the disabled API systemd unit is configured to run as root
from `server/.env`. This is a bounded snapshot, not proof against future/manual
one-shot jobs.

**Approved cutover would replace root PM2, not reload it.** Prepare a dedicated
`chatforia-api` OS user/group and the reviewed
[systemd unit template](chatforia-api-restricted.service.example). The template
launches `/usr/bin/node` directly from the server directory, avoiding npm's
`.env.production` override. Stage `/etc/chatforia/api-runtime.env` as root-owned
0600 systemd `EnvironmentFile`; it contains the **restricted** `chatforia_dev`
`DATABASE_URL` with verified TLS peer identity, existing compatible runtime
keys/Redis/provider settings, `STAFF_SECURITY_ENABLED=true`, and
`STAFF_DASHBOARD_ENABLED=false`, plus the verified
`STAFF_EXPECTED_DATABASE=defaultdb`. Do not copy the privileged URL. The unit
sets `DOTENV_CONFIG_PATH=/dev/null` so the app's dotenv import cannot load
legacy `.env`; omit both `DOTENV_CONFIG_PATH` and `DOTENV_CONFIG_OVERRIDE`
from the EnvironmentFile, which otherwise overrides the unit setting. The both-false
example is a preparation template, **not** valid post-migration auth config.
The migration reconciliation ID must be absent from runtime configuration.
Keep DBA/migration credentials in separate custody. The new app identity must
be unable to read root PM2 state, either `.env`, `.env.production` or its backup.
Do not print environment values while verifying this boundary.

The existing checkout and `server` directories are root-owned 0755 and can be
read by a dedicated user. The observed project `uploads` and `server/uploads`
directories are root-owned 0755; `server/tmp_uploads` is absent. Preserve the
three existing upload path defaults and contents, create the missing temp root,
and grant the dedicated user only the required write/read access to those
trees. Check existing file readability and avatar/local-media write/delete
through the private API without listing customer filenames or rewriting the
whole checkout. Do not blanket-chown source, env backups or migrations.

While traffic remains fenced, stop the old root PM2 tree and verify its listener
and all four inherited `doadmin` process environments have exited. Disable its
saved startup path so reboot cannot revive it; retain any privileged PM2/env
copies only in root/DBA custody outside the app's effective access. Install but
do not start the dedicated-user unit after the DBA-only migrations and key
bootstrap. Confirm the dedicated UID cannot read old privileged sources.
PR #300 makes the legacy manual backend workflow stop unconditionally before SSH;
its earlier service-state guard is historical context;
enable the new unit as part of the approved switch and do not dispatch that
workflow for this release.
Run the read-only runtime preflight under that UID with the same
systemd `WorkingDirectory` and `EnvironmentFile`; it must pass before the
listener is admitted. Verify the reviewed unit with `systemd-analyze verify`
before starting it. No root PM2 process may coexist with the new listener.

```sh
systemd-run --unit=chatforia-staff-runtime-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory=/var/www/chatforia-api/server \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  /usr/bin/node /var/www/chatforia-api/server/scripts/staff-deployment-preflight.mjs --runtime
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
Verify the new Node process UID, effective `DATABASE_URL` **username only**,
`SELECT current_user = 'chatforia_dev'`, role flags/memberships and verified-host
database TLS before any public admission.

The scheduled jobs start inside the same Node process, not in a separate
credential context. [CI 151](https://github.com/nortonjulian/chatforia/actions/runs/41769857115)
passed the PostgreSQL 18 role/bootstrap, schema and focused job probe. It
exercised ordinary token cleanup and representative cleanup/expiry/number-table
operations under `chatforia_dev`; ADMIN, staff and founder tokens stayed denied.

The cleanup predicates exclude ADMIN, staff-assigned and founder accounts;
the database trigger still blocks protected-token DML if protection changes
concurrently. In the fenced target window, confirm the immediate purge and
expiry ticks have no permission failures, inspect only sanitized job status,
and require the first scheduled hourly/daily runs to be monitored before
declaring the job cutover stable. Never run a live provider job merely as a
test. A failed DB operation, unexpected `doadmin` connection, protected-token
deletion, upload failure or missing job heartbeat is a stop condition: keep
ingress fenced, stop the new unit, preserve logs/ledger and repair under review.
After migrations, do not restore root PM2, the old privileged URL or pre-PR
code as a shortcut. Reopen traffic only after private API auth/MFA and ordinary
write/upload smoke plus the restricted-role/job checks pass; daily provider
effects remain under monitored operational observation.

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
privileged session. Losing both password and MFA requires a fresh issuer approval
record and a separate executor session. With one owner, these are two credentialed
steps by one person, not independent human approvals.

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
