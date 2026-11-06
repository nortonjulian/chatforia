# Stage 5 production change plan — preparation only

## Decision and authority

Prepared November 5, 2026 UTC following the owner's instruction to continue Stage 5.
No production execution is authorized by this document. Stage 6 admission has not begun.
Julian Norton is the release operator and stop authority identified in the conversation.
Separate DBA/security sign-offs are recommendations, not a newly imposed company policy.
A separate privileged database connection is a technical requirement; it does not by
itself require hiring a separate DBA. Recovery issuer/executor separation is an
implemented control and must not be confused with release sign-off recommendations.

## Verified checkpoint

- PR #293 merged the staff-security implementation, including founder management.
- PR #300 merged at `6a5f06d58c4414b7a0f584eeaede3118d3e9066b`.
  Its reviewed head passed both CI workflows, including PostgreSQL 18 rehearsal.
- Owner showed and saved an active Protect main ruleset targeting main with an
  empty bypass list, required pull requests, blocked force pushes/deletions,
  linear history, and required up-to-date Append-only Prisma migrations checks.
  Settings evidence is owner-provided screenshots/report, not an API export.
- Archive migration release #1 succeeded. The owner downloaded the release assets,
  obtained `migration-package.json: OK`, and confirmed the full merged commit and
  168 packaged files. The archive includes 160 SQL migrations (141 baseline plus
  19 staff migrations), schema, migration lockfile, dependency lockfile, aggregate
  check plan, exception manifest and its three evidence files.
- Local archive location is now
  `$HOME/Desktop/Chatforia-Deployment-Records`, not the earlier home-directory path.
  [Read-only follow-up](evidence/stage5-routing-backup-readonly-20261105.json)
  confirms the current directory is included in Time Machine and contains the
  review package and checksum. A [fresh read-only digest comparison](evidence/stage5-backup-readiness-followup-20261105.json)
  confirmed both local files match the retained GitHub Release asset digests;
  `shasum -c` passed. The Release is an independent copy of this **review**
  package. Time Machine still lists only `Macintosh HD (Local)` and no completed
  machine backup; no external physical disk is attached. A separate durable
  private backup of the eventual final package **and receipts** remains
  unverified; the owner deferred it while preparation continues.
- The owner accepted historical-data uncertainty for the four documented pairs
  and authorized preparing the exception for review. See
  [the exact acceptance record](migration-exception-review.md).
- Basic hosted restore readability passed: 141 completed migrations and the known
  QA account were found read-only. The temporary cluster was deleted by the owner.
  This is a real but bounded restore success, not all-record integrity, measured
  recovery time, key retrieval, or a fresh backup for the eventual change window.
- The single refund record matched the exact Stripe test payment ID, amount and
  timestamps; no eSIM replacement rows were present. Historical SQL remains unavailable.
- The owner reports successful DigitalOcean Recovery Console root login on both
  Droplets. A [read-only API memory/OOM snapshot](evidence/api-memory-oom-readonly-20261105.json)
  found `chatforia-api` online in PM2, loopback health `200` through the normal
  forwarded-HTTPS path, 420 MiB available RAM and no OOM kill recorded in the
  available kernel/systemd-oomd/syslog records for the prior 24 hours. This is
  a current-state check, not a capacity test or authorization to cut over.
- [Frontend run #623](evidence/frontend-deploy-and-ingress-readonly-20261105.json)
  deployed `main` commit `6a5f06d5` after SSH hardening. The stored Actions key
  reached the web host, rsync completed and nginx reload succeeded. The public
  page now references the synchronized JS/CSS assets. This was a frontend
  deployment, not PR #301's pinned `verify_ssh` mode or an API/staff cutover.
  The API checkout remains `b0ec6fd0`; unauthenticated `/staff/session` returns
  404 and `/admin/users` returns 401. That older API mounts an MFA-guarded
  read-only Admin Users list but lacks the new View/Edit detail handler; live
  View would lack a route and Edit stays disabled without `editableFields`.
  Repeated `www` 521s from one web fetcher conflict with direct 200s through
  the four locally DNS-advertised edge addresses. The owner also reported a
  successful cellular load at 10:25 PM Denver time on November 4; web-origin
  logs around that time show no 5xx or nginx errors. The source of the fetcher
  failure remains unknown. The separately approved
  [API-only firewall edit](evidence/api-firewall-applied-20261105.json) is now
  applied: operator-only SSH, Cloudflare-only HTTP/HTTPS, unchanged outbound,
  fresh SSH and dual-stack proxied health, direct-origin rejection, callback
  routing probes and the active API Certbot dry run all passed. The Telna
  account-level webhook setting is unknown, but no deployed usage/balance
  feature requires an incoming event;
  that limited residual risk is documented without making Telna support a
  blanket firewall approval prerequisite;
  see the [API-only ingress assessment](ingress-fencing-proposal.md).
- The separately authorized website nginx change is active: configuration parses,
  `/api/` uses `https://api.chatforia.com`, and upstream certificate verification,
  SNI and a trusted CA are configured. API nginx forwards to `127.0.0.1:5002`.
  The active frontend loads `env.js` with `__API_URL__=https://api.chatforia.com`,
  so normal browser API calls go directly to that origin; fencing only the web
  server's `/api/` location would leave the primary API path open.
  The owner reported an HTTP 404 proxy probe, which confirms a response for that
  path but not authenticated app behavior. The API listener binds `*:5002` and
  host UFW is inactive. The owner subsequently supplied firewall attachments,
  rules and proxied DNS/Full (strict) mode. Before the separately approved
  key-only SSH change, both global configurations reported
  `PasswordAuthentication yes` and `PermitRootLogin yes`; the API has an active
  nginx/Certbot renewal path on TCP 80. See the
  [sanitized evidence](evidence/stage5-routing-backup-readonly-20261105.json)
  and [exact ingress/fence proposal](ingress-fencing-proposal.md).

The current archived package is a preserved review checkpoint. Its manifest is still
`proposed-not-authorized-for-production`. It is NOT the final executable production
package for the drifted target. A later reviewed activation commit changes the manifest
bytes and both checksum pins, so it must receive a new archive and independent digest.
Do not modify this downloaded archive, reuse its checksum for another package, or
rewrite the database migration ledger.

## Fixed target and intended changes

| Item | Target / intended state |
| --- | --- |
| API host | Existing chatforia-api-01; checkout /var/www/chatforia-api |
| Database | chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb |
| Observed engine/history | PostgreSQL 18.6; 141 baseline migrations, four documented mismatches; refresh before window |
| Runtime DB role | chatforia_dev, restricted, no ownership or privileged memberships |
| Security owner | chatforia_staff_owner, NOLOGIN |
| Recovery roles | Separate chatforia_recovery_issuer and chatforia_recovery_executor, NOLOGIN |
| Runtime OS identity | chatforia-api user/group; systemd replaces root PM2 |
| Runtime configuration | /etc/chatforia/api-runtime.env, root-owned 0600; restricted connection only |
| Security flags after migration | STAFF_SECURITY_ENABLED=true; STAFF_DASHBOARD_ENABLED=false until separate admission |
| Migration count after upgrade | 160 completed; all 19 new SQL checksums exact; only four pinned historical pairs allowed |

Use [deployment-runbook.md](deployment-runbook.md) for detailed technical procedure,
[the package procedure](migration-release-packages.md) for migration execution, and
[the service template](chatforia-api-restricted.service.example) for process configuration.
[Ingress and temporary fencing](ingress-fencing-proposal.md) are separate
proposed production changes with their own approval and stop conditions.
The [exact SSH hardening diff](ssh-hardening-change.md) is now applied on both
Droplets. Public-key root login and fresh local deployment-labeled key no-op
checks passed; password authentication is disabled. The owner reported successful
out-of-band Recovery Console root login on both Droplets. Frontend run #623
also proved runner SSH access using the stored key; the pinned connection-only
mode is prepared but unrun, and the deployed workflow's host trust is unpinned.
Never dispatch the legacy backend deployment workflow.

## Preparation order, before requesting execution approval

1. **Decide the prepared ingress/fence rules.** The owner supplied the DigitalOcean
   firewall and Cloudflare facts; browser, web proxy and API loopback routes are
   verified. Review the [proposed rules](ingress-fencing-proposal.md), especially
   the completed key-only SSH change, standard GitHub Actions runner access to web TCP 22,
   the operator source for private API HTTPS, known provider callback behavior and
   the API Certbot HTTP-01 path. These are decisions, not permission to edit rules.
2. **Confirm identities and custody.** Privately verify the founder's account ID,
   email verification, MFA enrollment and already-linked sign-in provider. Do not
   infer ownership from email/name alone. Name actual initial staff/canary accounts,
   or explicitly start with founder only; do not invent a CTO or Access Admin.
   Confirm retrieval of existing APP_ENC_KEY/JWT/OAuth material independently of the
   API host and lost-device recovery. Do not paste keys, passwords or customer data.
   Record how distinct recovery issuer/executor login authority will be operated.
3. **Complete the change-window recovery record.** Select date/time/timezone and
   acceptable interruption; refresh managed backup health and available restore
   points, identify a usable independent restore destination, and plan the consistent
   encrypted export/role metadata capture. Do not recreate a paid restore cluster
   without separate authorization. Finish receipt-folder backup validation before
   approving execution; preparation may continue meanwhile.
4. **Prepare the activation release for a separate decision.** Only under explicit
   exception-activation authorization, change manifest status and both pins through
   review and tests. Existing CI deliberately expects the proposed state; update tests
   to preserve default-off, target/pair checks and no production use in CI. Obtain
   the separate merge decision, then create and verify a NEW archive for that merged
   commit. Archive application artifacts and the compatible recovery backend at
   the same reviewed revision. The current 6a5f06d archive is retained as evidence.
5. **Present a final approval record.** Fill every field below with verified values.
   No blank field, placeholder, old checkpoint, or passing CI substitutes for authorization.

## Execution sequence — only during the separately approved window

| Order | Action and expected result | Stop condition |
| --- | --- | --- |
| 1 | Apply the separately approved [temporary API ingress fence](ingress-fencing-proposal.md), drain requests, stop every API/background writer and verify no conflicting migration process; retain operator access and TCP 80 for ACME. | Any unidentified writer, unverified route, certificate-renewal conflict or inability to maintain the fence. |
| 2 | Capture/verify consistent recovery point, encrypted logical export, password-free ownership/role metadata, and recoverable key versions. Record timestamps and digests in private custody. | Unreadable backup/export, unavailable restore destination or missing key. |
| 3 | Through the separate privileged connection, execute guarded staff-production-prerequisite-roles.sql; provision runtime password privately, grant only migration executor scoped SET authority, then staff-access-bootstrap-role.sql. | Existing unsafe role/schema, unexpected target, provider permission/extension limitation. No CASCADE or blanket ownership reassignment. |
| 4 | Verify exact final package/digest and strict TLS. Run deploy-migration-package.mjs WITHOUT --execute from the reviewed checkout, using the independent private receipt archive and approved exception ID only in migration context. | Wrong host/database/port, any unexpected ledger entry, fifth mismatch, changed pair/file/evidence, invalid role/schema, failed catalog/data predicate or missing archive. |
| 5 | Run the SAME package/digest through the runner WITH --execute. Require a verified receipt, all 160 migrations complete, all 19 new hashes exact, unchanged user-count check and successful catalog/data predicates. | Any failure or partial migration. Do not retry blindly, edit the ledger, run migrate resolve or switch SQL. |
| 6 | Provision independent session/staff signing secrets through protected custody; preserve existing compatible encryption/JWT/provider keys. Initialize verified founder ownership with atomic audit/session invalidation under the reviewed bootstrap procedure. | Missing verified identity, inconsistent signing-key bytes/version, missing audit, or unapproved initial assignment. |
| 7 | Install reviewed non-root service and restricted environment, narrow upload permissions, isolate old privileged env/PM2 state, disable old startup path. Validate unit and effective access; run runtime preflight before admitting listener. | Any doadmin app/job connection, old root listener, readable privileged secret, unsafe membership/ownership, upload failure or readiness failure. |
| 8 | Retain the already applied website upstream-certificate verification. Apply only separately approved remaining proxy/firewall changes and the matching frontend artifact. Test private sign-in/MFA, pre-MFA denial, founder/delegate/admin boundaries, permitted audited change, ordinary write/upload, CSRF, logout and scheduled DB-job health. | Unauthorized access, missing audit, session/revocation failure, TLS/cookie/proxy failure, 5xx spike or failed job. Never trigger paid provider actions just to test. |
| 9 | Verify compatible process restart/recovery, one intended listener and restricted credentials after restart. Record baseline errors/latency and actual alert receipt. Keep dashboard off pending admission. | Process revives old code/credentials, missing alert path or unsafe recovery. |
| 10 | Request/execute separately authorized named-cohort admission (Stage 6), observe and expand only after acceptance criteria pass. | Any security failure; error rate >1% or staff API p95 >2x measured baseline for five minutes stops expansion. |

Scheduled hourly/daily jobs need observation at their normal cadence before declaring
the job cutover stable. API startup alone does not prove all provider jobs work.

The migration runner's advisory lock serializes its own invocations; operator fencing
must also exclude other migration tools. The 19 files are not one atomic transaction.
Receipts preserve actual historical hashes; normalization is comparison-only.

## Containment and recovery

Before any migration begins, an aborted window may restore the prior process/config
after reviewing any already-created role/schema dependencies and ordinary smoke checks.
Once migration begins, keep traffic fenced and inspect partial ledger/DDL. Do not restart
the pre-PR backend, restore root PM2/doadmin runtime, set security=false, or delete audits
or replay state. Use the reviewed compatible backend and repair forward.
Dashboard=false is limited containment and does not close global Admin APIs.
A database restore is a separate incident decision into an independent target and must
follow [older-snapshot-recovery.md](older-snapshot-recovery.md), reconciling post-backup
revocations, token floors, consumed assertions/approvals and audits before reopening.

## Final execution approval record — presently incomplete

- Final activation commit, package SHA-256 and release URL: pending.
- Application/frontend/recovery artifact digests: pending.
- Approved window and acceptable interruption: pending.
- Web/API proxy route, web upstream TLS, owner-provided DigitalOcean firewall
  attachments/rules and Cloudflare Full (strict): recorded. Exact operator source,
  key-only SSH: applied and locally verified. Exact operator source and
  approved/tested [ingress/fence rules](ingress-fencing-proposal.md): pending.
- Fresh backup/export time points, digests, restore destination and retrieval check: pending.
- Current review package and checksum match retained GitHub Release assets.
  Separate private backup of the final package and future private receipts:
  pending; local Time Machine has no completed machine backup.
- Verified founder/canary IDs and approved initial grants: pending private verification.
- Recovery operator identities and independent key retrieval: confirm privately.
- Operator/stop authority: Julian Norton; alert destination/receipt and observation window pending.
- Explicit permission for roles/schema, exception activation, migrations, keys/bootstrap,
  process/credential cutover, proxy/firewall changes and restart: NOT GRANTED.
- Explicit Stage 6 cohort admission: NOT GRANTED.

The remaining network decisions are grouped in
[ingress-fencing-proposal.md](ingress-fencing-proposal.md). Do not repeat the
owner-provided firewall/Cloudflare inspection; no firewall rule was changed.
The separately approved SSH-only change is recorded in
[execution evidence](evidence/ssh-hardening-applied-20261105.json).
