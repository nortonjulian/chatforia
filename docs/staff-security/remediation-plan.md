# PR #293 target remediation proposal — prepared only

Decision: **NO-GO for production cutover.** This plan uses the authorized
[read-only target inventory](infrastructure-inspection.md). Nothing below has
been executed on the Droplets or managed database. The existing seven-day PITR
option is an advertised capability, not a verified restore. CI 141/143/144,
local PG18.3 upgrade, Google/MFA/logout and Safari/Firefox checks remain valid;
none was repeated to prepare this plan.

The later [migration provenance follow-up](migration-reconciliation.md) searched
retained Droplet release directories/archives and GitHub Actions artifacts, and
compared current catalog defaults/indexes/FK actions. No original applied SQL
was found; the first hard stop below remains in force.

## Priority 0: resolve history before a change window

Actual `defaultdb` has 141 completed baseline migrations; four ledger checksums
do not equal current SQL. The [offline provenance tool](../../server/scripts/staff-migration-provenance.mjs)
compared the four recorded hashes to **every reachable Git revision that touched
each migration file**. It found no matching object. Current PR, inspected main
and deployed-file hashes agree; 263 copies in 67/62 local worktrees have only
those current hashes. Simple BOM/newline/CRLF variants and adjacent server
backup candidates also failed to match. The migration names and exact hashes
are in [sanitized evidence](evidence/live-infrastructure-inspection.json).
The bounded follow-up found 10 API SQL copies and four matching-named SQL members
inside retained archives, all with current hashes, and zero GitHub workflow
artifacts. A further 32 targeted catalog checks passed; see the reconciliation
record for exact scope and limits.

**Action:** locate the original applied SQL from a trusted deployment artifact,
signed build/archive, migration job record, or independently retained repository
object. Compare byte hashes to the ledger and review the full SQL against current
schema (including defaults, FK actions and index changes). Record provenance,
reviewer and compatibility decision. If no trusted artifact exists, obtain a
separately reviewed target-specific reconciliation design and synthetic rehearsal
before any ledger or DDL proposal. **Impact:** none during investigation.
**Verify:** all 141 active names, states and checksums have a documented
provenance/compatibility disposition, and the unchanged strict preflight accepts
the reviewed baseline only after a separately approved, legitimate repair.
**Rollback:** no production change in this step. Never replace an applied hash,
mark a migration resolved or edit historical SQL just to make preflight pass.
This is a hard stop; the remaining numbered actions are conditional.

## Priority 1: prepare recoverability and separate authority

1. **Backup and key custody.** Under a separately approved change window,
   verify current managed backup health and earliest/latest recovery points,
   take a consistent pre-change snapshot plus encrypted logical export and
   password-free role/ownership metadata, and verify an independent restore
   destination. Store existing `APP_ENC_KEY`, JWT and any existing session key
   under independent restricted custody; prepare independent new session and
   staff assertion keys. Never print keys, paste them into tickets, or put DBA
   credentials on the application host. **Impact:** backup I/O and restricted
   custody work; no user-facing change until cutover. **Verify:** timestamps,
   digests, retrieval by a second custodian and tested recovery procedure on an
   approved isolated destination. **Rollback:** stop before mutation if retrieval
   fails; retain existing keys/backup. A restore itself is a separately approved
   incident action, not an automatic rollback.
2. **Human authority.** Record named release/incident owners, independent
   recovery issuer and executor, verified founder and initial access-admin IDs,
   canary account IDs and alert recipients. **Impact:** governance only until
   approved bootstrap. **Verify:** no self-approval or shared recovery role;
   current MFA and provider identity on protected accounts. **Rollback:** cancel
   proposed assignments before activation; after activation use the protected,
   audited revocation service and preserve audit/replay history.

## Priority 2: security boundary while traffic is fenced

3. **Fence and capture.** Fence public auth/mutation routes, drain requests and
   stop all API/background writers only after explicit deployment approval.
   Pin the reviewed SHA and preserve the previous and new compatible artifacts.
   **Impact:** planned interruption of auth/write traffic. **Verify:** all known
   writers are stopped and backup timestamp postdates the fence. **Rollback:**
   before any migration, restore the old process/config and reopen only after
   ordinary login/MFA/health checks. If a migration has started, keep the fence
   and use the compatible new artifact/containment path; do not boot pre-PR code.
4. **Create restricted roles/schema.** A separate DBA checks the target and
   exact history; only then use the prepared
   [role SQL](../../server/scripts/staff-production-prerequisite-roles.sql) on
   `defaultdb`. It creates a no-password restricted LOGIN runtime and three
   NOLOGIN roles, atomically, failing on existing names/schema. Provision the
   runtime password out of band. Grant only the named migration executor scoped
   `SET` membership in `chatforia_staff_owner`, without granting it to runtime;
   verify PostgreSQL 18 membership options. Apply the reviewed
   [schema bootstrap](../../server/scripts/staff-access-bootstrap-role.sql)
   through the separate DBA connection. **Impact:** cluster-wide role creation
   and new schema, no existing table ownership transfer. **Verify:** role flags,
   membership graph, database/schema owners, no runtime SET/INHERIT path, no
   password in files/logs, and `--before-migrations` preflight. Provider-managed
   role limitations are a stop condition. **Rollback:** before migrations and
   only if unused, revoke newly granted membership, drop the new schema/roles in
   a separately reviewed transaction after dependency checks. Do not use CASCADE
   or blanket REASSIGN OWNED; otherwise leave fenced for DBA analysis.
5. **Install/verify pgcrypto and migrations.** The separate DBA confirms
   pgcrypto permissions/ownership on managed PostgreSQL 18; the reviewed
   migrations install it in `staff_security` if absent. Deploy exactly the 18
   pinned migrations under the separate executor while ingress stays fenced.
   **Impact:** database DDL, triggers and ACL restrictions; existing sessions
   will need revalidation. **Verify:** all 159 active migration hashes/states,
   pgcrypto namespace, protected writes rejected for runtime, ordinary writes
   permitted, assertion key match and audit/replay invariants. **Rollback:**
   never run a blind down migration. Stop on partial DDL, preserve ledger/audit,
   use the compatible new backend in containment, or follow a separately
   approved backup restore plus post-restore security reconciliation.
6. **Cut over credentials and sessions.** Move the API to a non-root process
   identity and restricted `chatforia_dev` connection, with verified database
   peer identity and approved CA/hostname. Remove/isolate privileged DB URLs
   from all app-readable env backups and PM2 saved state; merely replacing one
   URL is insufficient. Set independent strong `SESSION_SECRET` and
   `STAFF_ACCESS_SIGNING_SECRET`, matching the latter to the protected DB row.
   Preserve `APP_ENC_KEY` for existing MFA. Enable `STAFF_SECURITY_ENABLED=true`
   and keep dashboard false. The branch now refuses production startup without
   a strong independent session secret. **Impact:** old browser sessions may be
   invalidated; users reauthenticate/MFA. **Verify:** runtime preflight, process
   identity/effective file access, role privileges, signed-session behavior and
   no DBA credential reachable by the app. **Rollback:** while fenced, restore
   the approved compatible artifact and consistent new keys/restricted role;
   do not reintroduce the literal session fallback or privileged app URL.

## Priority 3: hosted boundary, recovery path and controlled admission

7. **Proxy and ingress.** Confirm Cloudflare mode/origin routing and DO Cloud
   Firewall attachments first. On the actual web origin, review the
   [nginx template](web-api-upstream.nginx.example) against active locations,
   trusted CA and API hostname; test `nginx -t`, then enable upstream certificate
   verification through an approved reload. Restrict API port 5002 to the
   trusted proxy/local path; determine whether its current all-interface bind
   must become loopback after checking background clients. **Impact:** bad CA or
   routing can cause API 502s; firewall changes may block clients. **Verify:**
   direct and public TLS hostname checks, correct proxied cookies/CSRF, blocked
   direct port, allowed provider callbacks and health. **Rollback:** while fenced,
   restore the prior proxy/firewall snapshot if connectivity fails, or keep
   ingress closed; never open an unverified direct bypass as a shortcut.
8. **Process recovery.** Reconcile the enabled-but-inactive PM2 systemd unit
   with the actual process manager and unprivileged runtime identity. Test the
   compatible start/stop/reboot recovery only in an approved isolated environment
   first, then within the fenced change window. **Impact:** possible restart
   downtime. **Verify:** one intended listener, consistent keys/role after
   restart and a pinned compatible artifact. **Rollback:** restore the reviewed
   unit/process configuration and restart the same compatible artifact while
   traffic remains fenced; preserve database security state.
9. **Hosted smoke, canary and opening.** With `STAFF_SECURITY_ENABLED=true`,
   dashboard still off, run the short hosted Google/password→MFA, pre-MFA denial,
   Support/Admin authorization, CSRF, logout denial and protected recovery
   smoke from the [runbook](deployment-runbook.md). Then explicitly approve
   named canaries, dashboard allowlist, incident owner and alert receipt.
   **Impact:** limited staff access and audited writes. **Verify:** one allowed
   edit produces one audit event; revocation kills sessions; latency/error
   baselines and rollback alert path are live. **Rollback:** turn dashboard off,
   retain security=true and fenced/compatible code, revoke via protected service
   or fence ingress if trust is lost. Preserve audits and replay history.

## Evidence still unavailable locally

- Original applied SQL or a trusted artifact for the four checksum mismatches.
- DigitalOcean backup health/actual recovery timestamps and an independently
  usable restore destination; a real restore is unverified.
- Cloud Firewall attachments/rules, Cloudflare SSL mode and hostname→origin
  routing, plus whether an already-paid dedicated isolated sandbox exists.
- Independently recoverable key storage/custodians, verified founder/recovery
  humans, canary IDs and incident/alert ownership.

The existing voicemail/wireless databases share production's role namespace and
cannot be used for isolated role/migration rehearsal. No paid sandbox is assumed.
The next approval request should name the exact target, operator, artifact SHA,
backup/custody evidence and each planned mutation. Read-only evidence gathering
does not authorize any step above.
