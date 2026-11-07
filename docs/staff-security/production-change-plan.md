# Stage 5 production change plan — preparation only

## Decision and authority

Prepared November 5, 2026 UTC following the owner's instruction to continue Stage 5.
No production execution is authorized by this document. Stage 6 admission has not begun.
Julian Norton is the release operator and stop authority identified in the conversation.
The current integrated decision, production action order and final-package backup
timing are in the [November 6 Stage 5 GO/NO-GO review](stage5-go-no-go-review-20261106.md).
Separate DBA/security sign-offs are recommendations, not a newly imposed company policy.
A separate privileged database connection is a technical requirement; it does not by
itself require hiring a separate DBA. Recovery issuer/executor separation is an
implemented database-login control. The sole owner accepted its residual
single-person risk on November 6: two credentials and sessions do not constitute
two-person approval.

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
  deployment, not an API/staff cutover. After the separately approved web
  firewall attachment, [run #624](evidence/web-firewall-applied-20261106.json)
  at PR #301 commit `fa181dde` passed the pinned-host `verify_ssh` job using
  the stored runner key; its deploy job was skipped. A fresh operator key login,
  proxied apex/`www` IPv4 and IPv6, dynamic page and assets, routing, service
  health and direct-origin rejection also passed. The owner confirmed the web
  firewall attached only to `chatforia-web-01`; the held SSH session was closed
  after verification. No rollback was needed.
  The API checkout remains `b0ec6fd0`; unauthenticated `/staff/session` returns
  404 and `/admin/users` returns 401. That older API mounts an MFA-guarded
  read-only Admin Users list but lacks the new View/Edit detail handler; live
  View would lack a route and Edit stays disabled without `editableFields`.
  Repeated `www` 521s from one web fetcher conflict with direct 200s through
  the four locally DNS-advertised edge addresses. The owner also reported a
  successful cellular load at 10:25 PM Denver time on November 4; web-origin
  logs around that time show no 5xx or nginx errors. The source of the fetcher
  failure remains unknown; the independent fetcher still returned 521 during
  [web firewall preparation](evidence/web-firewall-preparation-20261105.json)
  while local IPv4/IPv6 and direct-origin checks passed. The owner explicitly
  accepted this bounded uncertainty for web-only attachment with immediate
  detach rollback on a required-check failure. The post-attachment checks passed,
  but do not prove every Cloudflare edge is healthy. The separately approved
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

## Recovery-readiness checkpoint — November 6 UTC

The [local release candidate](evidence/recovery-package-local-20261106.json) was
built from committed Git objects at `ff1276c1` in an owner-only temporary
directory. Its package and checksum verified; all 168 embedded file hashes,
including 160 migrations, match the retained review archive. It has a different
commit field and digest, and its reconciliation status remains proposed. It is
**not** an executable final release for the drifted production target. The
runner's PostgreSQL 18 synthetic receipt-generation step passed in PR CI run
#174. Real preflight/execute receipts require an authorized target attempt and
cannot be manufactured now. The candidate has an
[AES-256 encrypted iCloud Drive backup](evidence/recovery-backup-icloud-20261106.json):
the owner reported web upload/download, and the separate returned copy passed
image checksum, decryption and full package verification. The owner reported
storing and retrieving the image passphrase independently in a password manager.
The original temporary image and passphrase remain intact. This verifies a
backup of the **proposed candidate**, not the still-missing backup of the final
activation package and future private receipts. The [final-package backup
procedure](migration-release-packages.md#private-custody-of-final-package-and-receipts)
is prepared; it cannot produce a real final backup until the separately
approved activation artifact and, later, actual attempt receipts exist. The
[preparation receipt](evidence/final-release-backup-preparation-20261106.json)
records this boundary without claiming a completed final backup.

The owner-controlled recovery record must be kept outside GitHub and the API
host. The owner selected the intended existing founder account; a
[read-only identity check](evidence/recovery-identity-readiness-20261106.json)
found one matching User row with verified email, enrolled MFA and linked Google
identity. The owner inspected and approved the exact immutable User ID privately
for a future bootstrap. This is **not** authority to insert the founder row or
grant staff access. Record the approved initial grant or founder-only start.
The owner is the sole recovery operator. Prepare two distinct restricted database
logins, with separately stored credentials and separate sessions. Verify that
issuer/executor memberships cannot overlap directly or transitively and that
neither login is the application runtime. See the
[sole-owner recovery procedure](sole-owner-recovery.md). This is preparation,
not permission to create logins, grant roles or use recovery in production.
The owner selected Apple Passwords for the issuer credential and a sealed paper
copy in secure storage for the executor credential. This is a storage plan only:
neither credential has been created, stored or retrieved, and no production
recovery login has been provisioned.

The existing `APP_ENC_KEY` now has an
[off-host Apple Passwords copy](evidence/app-enc-key-custody-20261106.json):
the saved Mac entry matched a fresh production-source read exactly, and the owner
reported retrieval and a full visual match on iPhone. Universal Clipboard did
not provide a usable automated iPhone comparison. The source file predates the
running API process, but its in-process value was not dumped. This is sole-owner
Apple Passwords custody, not independent human or provider custody. Independently
retrieve existing JWT and required OAuth material from off-host custody and
confirm it matches the running versions without printing values, hashes or
tokens in public evidence. Record custodian, retrieval date and a redacted match
result privately. New session/staff signing keys need separate protected custody
only in the approved cutover; never generate them during preparation. Choose an
independently durable private storage location for the **final** activation
package, its checksum and every future receipt attempt directory. Prove a
read-back copy with SHA-256 verification and
owner-only access; local Time Machine currently has no completed machine backup.
The [existing Twilio Auth Token](evidence/twilio-auth-token-retrieval-20261106.json)
was retrieved from the matching Twilio Console account and exactly matched the
deployed source without displaying it. The Console is an off-server retrieval
path; no extra Apple Passwords token copy or rotation was needed.
See [package and receipt custody](migration-release-packages.md).

## Fixed target and intended changes

| Item | Target / intended state |
| --- | --- |
| API host | Existing chatforia-api-01; checkout /var/www/chatforia-api |
| Database | chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb |
| Observed engine/history | PostgreSQL 18.6; 141 baseline migrations, four documented mismatches; refresh before window |
| Runtime DB role | chatforia_dev, restricted, no ownership or privileged memberships |
| Security owner | chatforia_staff_owner, NOLOGIN |
| Recovery roles | Separate chatforia_recovery_issuer and chatforia_recovery_executor, NOLOGIN; proposed issuer/executor LOGIN principals are password-free until separately approved provisioning |
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
mode passed in run #624 after web firewall attachment. The current `main`
deployment workflow's host trust remains unpinned until the reviewed branch
change is merged.
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
   Record separate issuer/executor credential custody and session use under the
   accepted sole-owner procedure; do not claim a second human approval.
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
| 3 | Through the separate privileged connection, execute guarded staff-production-prerequisite-roles.sql; provision runtime password privately, grant only migration executor scoped SET authority, then staff-access-bootstrap-role.sql. Under its own approval, execute staff-recovery-operator-logins.sql; provision two separate passwords privately, store and retrieve them from the selected independent locations, and verify distinct-session role isolation. | Existing unsafe role/schema, unexpected target, provider permission/extension limitation, cross-role membership or failed credential retrieval. No CASCADE or blanket ownership reassignment. |
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
  key-only SSH and permanent web/API ingress rules: applied and verified as
  [recorded here](ingress-fencing-proposal.md). The temporary migration fence
  remains proposed and requires separate approval.
- Fresh backup/export time points, digests, restore destination and retrieval check: pending.
- Current review package and checksum match retained GitHub Release assets.
  Separate private backup of the final package and future private receipts:
  pending; local Time Machine has no completed machine backup.
- Founder ID: verified and owner-approved privately for a future bootstrap;
  canary IDs and initial staff grants remain pending private verification and
  separate execution approval.
- Sole-owner recovery risk: accepted for preparation. Issuer/executor storage
  locations are selected; restricted login and credential creation, separate
  storage/retrieval checks remain pending separate production approval.
- Existing `APP_ENC_KEY`: off-host Apple Passwords exact Mac readback passed;
  owner-reported iPhone retrieval/full visual match passed. Existing JWT and
  required OAuth material still lack independent off-host retrieval evidence.
- Existing Twilio Auth Token: matching current primary token retrieved from
  Twilio Console and exactly compared to production; no additional copy created.
- Operator/stop authority: Julian Norton; alert destination/receipt and observation window pending.
- Explicit permission for roles/schema, exception activation, migrations, keys/bootstrap,
  process/credential cutover, proxy/firewall changes and restart: NOT GRANTED.
- Explicit Stage 6 cohort admission: NOT GRANTED.

The remaining temporary-fence decision is documented in
[ingress-fencing-proposal.md](ingress-fencing-proposal.md). Do not repeat the
owner-provided firewall/Cloudflare inspection. The permanent API rule edits and
web-only firewall attachment have already been executed under separate approvals.
The separately approved SSH-only change is recorded in
[execution evidence](evidence/ssh-hardening-applied-20261105.json).
