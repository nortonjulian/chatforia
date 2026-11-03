# Staff security release plan — PR #293

## Decision and scope

**GO for review of the implementation; NO-GO for deployment today.** The remaining
blockers are target-specific operational evidence and explicit approval, not a
request to repeat passing local browser suites or fix unrelated launch work.
PR [#293](https://github.com/nortonjulian/chatforia/pull/293) stays draft. No merge,
deployment, production mutation, existing-database migration or spending occurred.

**Read-only inspection is now authorized.** The initial
[infrastructure inspection](infrastructure-inspection.md) verified public edge
TLS, HTTP redirects and API security-header/CSRF-cookie attributes. SSH/database
inspection awaits verified Droplet IP/SSH-user mapping; account backup/resource
inventory has partial owner-reported console evidence below.
No authenticated server/database connection has yet been made. These specific
access prerequisites replace the previous request for inspection authorization.

The owner reports chatforia-db is **PostgreSQL 18, primary-only in SFO2**, with
Network Access restricted to chatforia-api-01; the console lists doadmin, defaultdb
and two existing voicemail/wireless test databases. Recovery options are latest
transaction or point in time up to seven days into a new cluster. No restore was
performed. Actual SQL roles, runtime connection identity, pgcrypto and key custody
are not established by these console listings.

A new **PostgreSQL 18.3 local synthetic upgrade passes 11/11 checks**. The
preflight now accepts the explicitly exercised major versions 16 and 18 without
relaxing database privilege/key/history checks. See
[new engine evidence](evidence/postgres18-upgrade-local.json). No existing
database, paid service or completed browser suite was used.

This record supersedes the older broad gate lists in the historical acceptance,
checkpoint, rehearsal and staging-proposal records. The executable local work and
exact future deployment/preflight/abort/rollback sequence are in
[deployment-runbook.md](deployment-runbook.md). Commands there are prepared only.

## Evidence retained, without rerunning completed browser QA

- [CI 141](https://github.com/nortonjulian/chatforia/actions/runs/41701102110)
  passed on `9974f507a7c0da7c8cdbdea13893dd2c7cd8ddfc`: 274 staff tests,
  129 room/server tests, five client tests, all 159 disposable PostgreSQL
  migrations, older-snapshot reconciliation/recovered access, scoped lint,
  release verification and Node 22 client build. This remains the application
  checkpoint; follow-up CI separately verifies the new readiness tooling.
- Real Google web sign-in → Chatforia MFA → SUPPORT passed. Pre-MFA staff/admin
  returned 401; post-MFA SUPPORT 200 and Admin 403; observed logout then
  staff/admin/session all returned 401. All four observer booleans are true.
  [Sanitized evidence](evidence/google-oauth-local-20261103.json) and
  [scope/procedure](google-oauth-local.md). No claim of real Apple/mobile OAuth.
- Safari and Firefox admin login/MFA, View, Cancel, Save with reason, persistence
  after reload and logout/Back/reload denial are **user-reported passes**. Chrome
  full shell/UserContext/routing and detailed Users validation/denial/focus/layout
  automation already passed. No browser suite was repeated for this readiness work.
- Synthetic exact-snapshot restore: 14 datasets matched, six security/restore
  checks, positive restored MFA and new token writes. Older-snapshot recovery:
  ten checks through authenticated reconciliation and controlled reopening;
  revived sessions/grants/replays denied and legitimate recovered access works.
  These do not certify managed backup/PITR, real key custody or human recovery.
- New readiness verification: **11/11 checks passed**, populated 141→159 migration upgrade with preserved
  existing synthetic ordinary/admin users, non-superuser executor, read-only
  preflight rejection cases and runtime containment configurations. See
  [deployment evidence](evidence/deployment-readiness-local.json). No existing
  database or paid integration is accepted by this rehearsal.

## Final security review

Reviewed the latest CORS, session/MFA/token, protected credential/reset, permission
DTO, audit and runtime-boundary changes against main and the complete 18-migration
sequence. No new concrete application defect was identified in this review.
The `localhost:5002` CORS addition is development-only; production allowlist is
unchanged, including its pre-existing localhost:5173 entry. It does not bypass
CSRF, reflect arbitrary origins or weaken MFA. Removal of that pre-existing
production development origin is a separate policy/hardening decision; this PR
neither adds nor relies on it in production.

Readiness defects corrected: the release verifier previously pinned only four
of the 18 added migrations; it now pins all 18 while preserving the original four
hashes. The plan previously treated the both-false template as generally safe;
after migration security=true is mandatory before authentication reopens.
The new preflight refuses disabled security, mismatched keys, unsafe role/schema
prerequisites and divergent baseline migration history. It does not provision or
repair anything. Existing application authorization/recovery rules are unchanged.

Existing manual deployment workflows are not suitable for this first security
migration cutover as written (moving main, no fencing/role/key preparation or
separate migration connection). The runbook supplies the controlled alternative.
Push/PR CI cannot dispatch deployment through repository workflow triggers;
Droplet-side polling remains uninspected. No deployment workflow was dispatched.

## Gates assessed against this release

| Gate | Disposition and smallest missing evidence |
| --- | --- |
| Changed authorization, MFA, recovery, audit, Users actions and CORS | Local implementation and focused regressions complete; ordinary reviewer approval is still required before merge. This is not independent penetration-test certification. |
| Repository-wide lint | Existing debt: 384 errors / 2,609 warnings in the documented same-rule comparison, zero introduced findings. Scoped staff lint and PR CI pass. Defer broad cleanup to its own work; do not call full-root lint green or make unrelated cleanup a new technical prerequisite for this release. If repository policy requires root lint, the owner must explicitly disposition that policy. |
| Migration/role/pgcrypto compatibility on the actual target | **Deployment blocker.** PG18/topology/network source are console-reported and local PG18 upgrade passes. Still need catalog-only database identity, owners, SET/INHERIT memberships, pgcrypto namespace and migration checksums. Console listing doadmin does not prove the application's role or absence of SQL-created NOLOGIN roles. Wrong namespace/runtime ownership requires a reviewed target-specific transition and isolated rehearsal before any mutation. |
| Recoverable backup and key custody | **Before-migration blocker.** Seven-day latest-transaction/PITR-to-new-cluster options are console-reported. Actual restore success, recovery time points/RPO/RTO, independent destination and separately recoverable encryption/signing keys remain unverified. Local restore/reconciliation already passed; no repetition requested. No production data enters local QA. |
| Hosted HTTPS/proxy/cookies/CSRF and process topology | **Before-public-traffic blocker.** Need the actual topology/config metadata and a short fenced deployment smoke on the approved target. Local HTTP cannot certify Secure/domain cookies, reverse proxy trust or key consistency across deployed instances. A separate environment is necessary to rehearse the actual provider boundary without touching production. |
| Founder/initial authority and independent recovery operators | **Before-dashboard/recovery activation blocker.** Need verified account IDs, distinct human approver/executor logins, secret custody and approved identity verification. No automatic promotion or invented founder. Initial assignments require separately approved atomic audited infrastructure bootstrap; later changes use protected APIs. |
| Canary/alerts/containment | **Before-rollout blocker.** Need named canary IDs, incident/observation owners, actual alert receipt and error/latency baselines. Dashboard disable does not disable the global Admin Users APIs; incident containment may require wider ingress fencing. Actual process rollback remains target verification, not a local claim. |
| Real Apple or mobile provider/device matrix | Unverified. Provider handlers/identity resolution are unchanged, and shared MFA/state/token behavior has offline coverage plus the real Google web proof. Defer expansion to Apple/mobile staff use outside the initial web cohort. If any such flow already serves affected users, include its minimal sign-in/MFA smoke before traffic reopens; migration effects are global, not canary-scoped. Mocked OAuth is never provider certification. |
| Additional Safari/Firefox/mobile/screen-reader matrix | Six specified Safari/Firefox flows are complete as user-reported; Chrome keyboard and narrow layout checks passed. Broader real-device/a11y certification is launch work beyond this patch. No known unresolved UI defect requires repeating those six flows. |
| SMS, billing, telecom, unrelated integrations and assertion-retention scheduling | Outside this PR's initial staff canary. No paid-provider testing/provisioning authorized. Existing jobs must nevertheless be inventoried/fenced during migration; retention is later capacity work, not permission to delete audit/live replay state. |

## Zero-cost next boundary

No verified dedicated DigitalOcean sandbox is known. The two reported existing
voicemail/wireless test databases are on chatforia-db and are not isolated for
staff-role/migration testing. Reusing chatforia-db via a
second logical database is **not sufficient isolation**: role names/memberships
are cluster-wide. A container on either production Droplet does not prove CPU,
network, secret or data isolation and is not authorized. A separate paid service
would be needed if no already-paid dedicated sandbox exists; spending remains
prohibited and those provider checks remain pending rather than fabricated.

The smallest next action is **the Droplet IP/SSH-user mapping**, followed by
available account visibility or the exact redacted console metadata listed in
[infrastructure-inspection.md](infrastructure-inspection.md): remaining SQL
role/ownership/extension/migration metadata, current process/proxy/deployment
configuration, existing backup/restore/key-custody evidence, and whether an
already-paid dedicated non-production sandbox exists. No credentials or data
export is needed. This can resolve compatibility unknowns and determine whether
provider rehearsal is possible at $0. Read-only inspection is authorized;
migration, resource creation, production mutation and rollout remain prohibited.

The preparation tool is ready for a later approved operator:
`node server/scripts/staff-deployment-preflight.mjs --before-migrations` after
DBA prerequisite preparation, and `--runtime` after migration/key provisioning.
Both run read-only transactions and suppress driver errors that could disclose
connection information. The first verifies the exact 141-migration baseline,
not a partially migrated target. All required execution/abort details are in the
runbook; no commands have been run against existing infrastructure.

## Approval record still required for execution

Record the reviewed SHA/artifact hashes, exact target and migration ledger,
backup/restore/key-custody evidence, DBA and independent recovery operators,
verified founder/initial authority, canary IDs, incident/alert owners and change
window. Deployment, migration, staff bootstrap and public rollout each remain
subject to the owner's explicit authorization. Keep security=true after the
migration; retain security schema, audits and replay history on rollback.
No down migration or pre-PR backend rollback is approved.
