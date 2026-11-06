# Staff security release plan — PR #293

**Current operational status:** [production-change-plan.md](production-change-plan.md)
supersedes stale checkpoint/status statements below. PRs #293 and #300 are merged;
the release has 141 baseline plus 19 new migrations (160 total). The owner accepted
historical uncertainty for review only; production exception activation remains blocked.
A basic hosted restore readability check passed, not exhaustive integrity or measured
RPO/RTO. The archived review package is verified locally; a final activation release
will require a new archive. No production cutover or Stage 6 admission is authorized.


## Decision and scope

**GO for review of the implementation; NO-GO for deployment today.** The remaining
blockers are observed target configuration/history, remaining operational
evidence and explicit approval, not a
request to repeat passing local browser suites or fix unrelated launch work.
PR [#293](https://github.com/nortonjulian/chatforia/pull/293) stays draft. No merge,
deployment, production mutation, existing-database migration or spending occurred.

The [ordered remediation proposal](remediation-plan.md) specifies actions,
impacts, verification and rollback for each observed target blocker. Its first
hard stop is the four unmatched baseline migration checksums; no ledger bypass
or production mutation is proposed to hide them.
The [credential cutover inspection](evidence/database-credential-cutover-inspection.json)
pins the live root PM2/API environment sources: both npm and Node inherit
`doadmin`, production dotenv overrides from `server/.env.production`, and
scheduled jobs run in the same API process. No separate running database worker
was observed. The [runbook](deployment-runbook.md) now uses a dedicated non-root
service, restricted systemd environment and narrow upload access; root PM2
reload is not an acceptable credential cutover.
The focused restricted-role cron probe passed in isolated
[CI 151](https://github.com/nortonjulian/chatforia/actions/runs/41769857115);
protected tokens remained denied. The branch's legacy backend workflow now
fails closed once the dedicated API service is enabled or active. Actual
non-root startup, provider jobs and upload access remain approved-window checks.
The [read-only provenance/schema follow-up](migration-reconciliation.md) searched
retained release directories, archives and available CI artifacts. No original
applied SQL was recovered. Additional catalog comparisons passed but cannot
replace a trusted applied artifact or reviewed reconciliation.
The [per-migration design](migration-reconciliation.md) records all four hash
pairs and historical data-effect uncertainty. A bounded read-only target check
passed current-data predicates for each migration, but does not establish
historical DML or independent provider/payment reconciliation. The pinned
artifact route is unusable without checksum-matching original bytes; the
current-SQL reconstruction is not production authorization. A target-bound,
versioned preflight reconciliation is implemented for isolated CI testing but
its manifest status blocks production activation. Database/security review is
recommended rather than mandated by existing policy; deployment remains blocked.
Isolated [CI run 147](https://github.com/nortonjulian/chatforia/actions/runs/41730818442)
passed prepared role SQL on PostgreSQL 18.6, the available 141-file
reconstruction, all 215 collected catalog entries and strict rejection of the
four target hashes. DigitalOcean role/extension behavior and historical data
effects remain unproven.

**Authorized read-only inspection succeeded.** Existing keys authenticated root
on both owner-confirmed Droplets. [Infrastructure inspection](infrastructure-inspection.md)
now records actual PostgreSQL 18.6/defaultdb, privileged doadmin runtime/ownership,
missing restricted roles/schema, available but uninstalled pgcrypto, and four
pre-existing baseline checksum mismatches. It also records nginx/process/key-file
metadata, absent SESSION_SECRET with a deployed literal fallback, missing staff
signing key and disabled web upstream certificate verification. No customer rows
or secret values were returned and no target mutation occurred.

The owner reports chatforia-db is **PostgreSQL 18, primary-only in SFO2**, with
Network Access restricted to chatforia-api-01; the console lists doadmin, defaultdb
and two existing voicemail/wireless test databases. Recovery options are latest
transaction or point in time up to seven days into a new cluster. No restore was
performed. The later catalog/config inspection independently verifies SQL state;
same-host 0600 key copies do not establish independent recovery custody.

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
- [CI 143](https://github.com/nortonjulian/chatforia/actions/runs/41713557005)
  passed on `688903592ab264b6cbe18b6526c9d7b395e47ba0`, including the readiness
  tooling. CI uses PostgreSQL 16; the separate local PG18.3 result passes 11/11.
  This read-only follow-up changes evidence/documentation only and reuses those
  completed application/browser checks.

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
No direct deployment polling was found in inspected host cron/systemd locations;
this does not rule out external automation. No deployment workflow was dispatched.

## Gates assessed against this release

| Gate | Disposition and smallest missing evidence |
| --- | --- |
| Changed authorization, MFA, recovery, audit, Users actions and CORS | Local implementation and focused regressions complete; ordinary reviewer approval is still required before merge. This is not independent penetration-test certification. |
| Repository-wide lint | Existing debt: 384 errors / 2,609 warnings in the documented same-rule comparison, zero introduced findings. Scoped staff lint and PR CI pass. Defer broad cleanup to its own work; do not call full-root lint green or make unrelated cleanup a new technical prerequisite for this release. If repository policy requires root lint, the owner must explicitly disposition that policy. |
| Migration/role/pgcrypto compatibility on the actual target | **Known deployment blocker.** Actual PG18.6/defaultdb runtime is doadmin with CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS and table ownership. Four required roles and staff_security are absent; pgcrypto 1.4 is available but not installed (no namespace conflict). 141 active baseline migrations exist, but four checksums differ from PR/main/deployed files. Current catalog and bounded data invariants pass; neither proves original DML. With originals unavailable, the pinned-artifact route cannot clear strict preflight. A target-bound, versioned exception is implemented only for isolated testing; its manifest blocks production activation pending separate owner risk acceptance and code review. No ledger rewrite or silent waiver is authorized. Prepare restricted-runtime credentials/DBA bootstrap and provider-compatible extension ownership only under future approval. |
| Recoverable backup and key custody | **Before-migration blocker.** Seven-day latest-transaction/PITR-to-new-cluster options are console-reported, and a bounded hosted restore read-only check succeeded (141 completed migrations and known QA account). Full hosted integrity, change-window recovery point/RPO/RTO and independent key retrieval remain unverified. The retained GitHub Release asset digests match the local review package and checksum, but a separate private backup of the final activation package and future receipts is not verified; local Time Machine has no completed machine backup. Local restore/reconciliation already passed; no repetition requested. See the [read-only follow-up](evidence/stage5-backup-readiness-followup-20261105.json). |
| Hosted HTTPS/proxy/cookies/CSRF and process topology | **Before-public-traffic blocker.** Metadata is inspected: one API HTTP listener under root PM2, trust-proxy=1 and secure domain cookie configuration. The approved website upstream certificate-verification fix and [API-only Cloudflare ingress](evidence/api-firewall-applied-20261105.json) are active; fresh SSH, dual-stack API health, direct-origin rejection, callback routing probes and the active API certificate dry run passed. SESSION_SECRET is absent with a literal fallback; staff signing key is absent. Require approved key custody, verified DB TLS identity and a fenced deployment smoke. Web ingress remains a separate decision. Enabled-but-inactive PM2 systemd unit leaves reboot/rollback unverified. No restart was attempted. |
| Founder/initial authority and independent recovery operators | **Before-dashboard/recovery activation blocker.** Need verified account IDs, distinct human approver/executor logins, secret custody and approved identity verification. No automatic promotion or invented founder. Initial assignments require separately approved atomic audited infrastructure bootstrap; later changes use protected APIs. |
| Canary/alerts/containment | **Before-rollout blocker.** Need named canary IDs, incident/observation owners, actual alert receipt and error/latency baselines. Dashboard disable does not disable the global Admin Users APIs; incident containment may require wider ingress fencing. Actual process rollback remains target verification, not a local claim. |
| Real Apple or mobile provider/device matrix | Unverified. Provider handlers/identity resolution are unchanged, and shared MFA/state/token behavior has offline coverage plus the real Google web proof. Defer expansion to Apple/mobile staff use outside the initial web cohort. If any such flow already serves affected users, include its minimal sign-in/MFA smoke before traffic reopens; migration effects are global, not canary-scoped. Mocked OAuth is never provider certification. |
| Additional Safari/Firefox/mobile/screen-reader matrix | Six specified Safari/Firefox flows are complete as user-reported; Chrome keyboard and narrow layout checks passed. Broader real-device/a11y certification is launch work beyond this patch. No known unresolved UI defect requires repeating those six flows. |
| SMS, billing, telecom, unrelated integrations and assertion-retention scheduling | Outside this PR's initial staff canary. No paid-provider testing/provisioning authorized. The [API ingress probes](evidence/api-firewall-applied-20261105.json) exposed a pre-existing Twilio authenticity issue: deployed voice and SMS inbound handlers lack signature validation, so empty unsigned requests receive TwiML. Review and fix this separately; do not treat route reachability as real-provider authentication. App Store Connect's Production and Sandbox Server Notification URLs are owner-verified unconfigured; their setup and verification remain Apple billing launch-readiness work, not an API firewall destination blocker. Twilio's Porting Webhook configuration resource is absent in the configured parent account; functional porting submission/callback support is later launch work. Existing jobs must nevertheless be inventoried/fenced during migration; retention is later capacity work, not permission to delete audit/live replay state. |

## Zero-cost next boundary

No verified dedicated DigitalOcean sandbox is known. The two reported existing
voicemail/wireless test databases are on chatforia-db and are not isolated for
staff-role/migration testing. Reusing chatforia-db via a
second logical database is **not sufficient isolation**: role names/memberships
are cluster-wide. A container on either production Droplet does not prove CPU,
network, secret or data isolation and is not authorized. A separate paid service
would be needed if no already-paid dedicated sandbox exists; spending remains
prohibited and those provider checks remain pending rather than fabricated.

SSH and SQL access are no longer missing prerequisites. The smallest next evidence
is **trusted applied SQL/provenance for the four drifted baseline migrations**,
plus account-only Cloud Firewall/Cloudflare routing and TLS settings, backup
health/recovery timestamps, independent key custody and dedicated sandbox
inventory. Exact console screens/redacted metadata are listed in
[infrastructure-inspection.md](infrastructure-inspection.md). No credential or
customer-data export is needed. A separately approved remediation must isolate
DBA/recovery credentials from the root application's effective access, provision
the restricted runtime/session/staff keys and correct transport verification.
Migration, resource creation, production mutation and rollout remain prohibited.

The preparation tool is ready for a later approved operator:
`node server/scripts/staff-deployment-preflight.mjs --before-migrations` after
DBA prerequisite preparation, and `--runtime` after migration/key provisioning.
Both run read-only transactions and suppress driver errors that could disclose
connection information. The first verifies the exact 141-migration baseline,
not a partially migrated target. All required execution/abort details are in the
runbook; neither preflight execution requiring prepared roles nor any deployment
command has been run against existing infrastructure. The independent catalog
inspection was read-only and already establishes why preflight would reject it.

## Approval record still required for execution

Record the reviewed SHA/artifact hashes, exact target and migration ledger,
backup/restore/key-custody evidence, DBA and independent recovery operators,
verified founder/initial authority, canary IDs, incident/alert owners and change
window. Deployment, migration, staff bootstrap and public rollout each remain
subject to the owner's explicit authorization. Keep security=true after the
migration; retain security schema, audits and replay history on rollback.
No down migration or pre-PR backend rollback is approved.
