# Staff-security acceptance record

## Deployment-readiness checkpoint — 2026-11-03

The subsequent [remediation proposal](remediation-plan.md) adds a production
session-secret startup guard, prepared role/HTTPS templates and an offline
migration-provenance tool. Four recorded hashes remain unmatched in reachable Git
history and 263 local migration-file copies. Local target role SQL execution is
still pending: macOS refused a new PostgreSQL 18 cluster at `initdb` because
shared memory could not be allocated; the existing synthetic preview was left
running. The static role guard and focused session-secret/provenance tests pass.
This tooling does not authorize a production change or waive strict preflight.

The subsequent [read-only provenance and schema follow-up](migration-reconciliation.md)
found no recorded hash match in retained Droplet release SQL, inspected archives
or available GitHub CI artifacts. The target catalog passes 32 additional
default/index/FK-action checks, but historical SQL equivalence is not proven.
The local `shmget` failure reproduces outside the sandbox; the role-SQL fresh
cluster test remains pending without changing shared settings or the preview.
The equivalent role-SQL execution and available-baseline reconstruction then
passed on isolated PostgreSQL 18.6 in [CI run 147](https://github.com/nortonjulian/chatforia/actions/runs/41730818442):
141 migrations, 215/215 current catalog entries and rejection of all four
recorded target hashes by strict preflight. This closes isolated PG18 testing;
it does not prove original SQL/data effects or DigitalOcean permissions.

Authorized [read-only infrastructure inspection](infrastructure-inspection.md)
now includes successful root SSH to both owner-confirmed Droplets and catalog
queries from the API host using its existing connection. **NO-GO for deployment**:
the actual runtime is privileged `doadmin` on PostgreSQL 18.6/defaultdb; required
restricted roles/schema are absent, pgcrypto is available but uninstalled, and
four of 141 active baseline migration checksums differ. These are pre-existing
target conditions, not new PR migration edits. No production mutation or browser
QA repetition was performed. See [sanitized evidence](evidence/live-infrastructure-inspection.json).

Inspected secret files are root-owned 0600 and existing MFA/JWT keys match
same-host copies, but independent recovery custody is unverified. No configured
SESSION_SECRET was found and deployed session code has a literal fallback;
the new staff signing key is absent. The web proxy disables upstream certificate
verification. Actual cloud firewall/Cloudflare policy, provider restore success
and process rollback remain unverified. These findings now replace the previous
missing-SSH-mapping gate; a safe, separately approved remediation is required.

Owner-reported console evidence now establishes PostgreSQL 18, primary-only SFO2,
chatforia-api-01 as the sole Network Access entry, doadmin as the visible user,
defaultdb plus two existing voicemail/wireless test databases, and seven-day
latest-transaction/PITR options into a new cluster. Restore success remains
unverified; SQL role/ownership/pgcrypto metadata is now inspected. The test databases
share production's role namespace; they are not isolated staging resources.
A new fresh PostgreSQL 18.3 synthetic upgrade passes **11/11 checks**; the
read-only preflight now explicitly supports tested majors 16 and 18. No security
privilege checks or migration SQL were relaxed. See
[console report](evidence/digitalocean-console-report.json) and
[PG18 local evidence](evidence/postgres18-upgrade-local.json).

**Local work complete; GO for review, NO-GO for deployment pending target
remediation, remaining evidence and approval.** [release-plan.md](release-plan.md) provides the authoritative
gate assessment; its scope supersedes the broader historical pending lists below.
Existing root lint debt and unrelated launch work are not newly introduced code
blockers. No new application defect was found in the final scoped security/CORS
review, and no security restriction or reviewed migration SQL was changed.

Reused successful [CI 141](https://github.com/nortonjulian/chatforia/actions/runs/41701102110)
on `9974f507`: 274 staff tests, 129 room/server tests, five client tests, all 159
disposable migrations, older-snapshot recovery, scoped lint/release checks and
Node 22 build. Reused the real Google/MFA/SUPPORT/Admin-denial/logout report and
the six user-reported Safari/Firefox passes. No browser QA was repeated.

New work pins all **18** branch migrations (the prior four hashes are unchanged),
adds read-only pre-/post-migration checks, and passes **11/11** checks for a populated 141→159
upgrade in a newly created synthetic cluster. The preflight catches missing
roles, wrong database, baseline checksum drift, wrong pgcrypto namespace, runtime
ownership/SET membership, missing/mismatched signing keys and security disabled
after migration. Existing user rows survive, ordinary writes work and protected
administrator credential writes remain denied. Both canary and dashboard-off
containment configurations retain runtime readiness. See the sanitized
[new evidence](evidence/deployment-readiness-local.json) and
[exact deployment/abort/rollback procedure](deployment-runbook.md).

The synthetic upgrade used no existing database, production data or paid service.
The subsequent authorized production inspection was metadata-only and read-only.
Latest application/tooling checkpoint [CI 143](https://github.com/nortonjulian/chatforia/actions/runs/41713557005)
passed on `688903592ab264b6cbe18b6526c9d7b395e47ba0`; local PG18.3 upgrade remains
11/11. No completed suites were repeated for this documentation-only inspection.
Next evidence is trusted applied SQL/provenance for the four drifted migrations
and the account/custody metadata specified in the inspection record. No paid
provisioning, checksum waiver or existing-database migration is authorized.

Real Google web OAuth → Chatforia MFA → SUPPORT authorization/logout is now locally
verified. See [Google result and exact remaining scope](google-oauth-local.md).


Current checkpoint: [2026-11-03 completed work, user-reported browser passes and remaining release gates](checkpoint-20261103.md). This supersedes older pending notes for the six reported Safari/Firefox admin flows.


## Full application browser follow-up

The zero-cost harness in [full-browser-local.md](full-browser-local.md) mounts the
actual client entry point, UserContext, router and password/MFA forms against the
real app factory and a fresh restricted-role synthetic database. External services
and unrelated paid routes are unavailable; OAuth is disabled, not provider-verified.

The full-shell run exposed configured-cookie logout persistence: the server cleared
only legacy cookie aliases, so a custom JWT cookie restored the session on reload.
Logout now clears the configured name using its actual issuing scope before retaining
the existing legacy cleanup. Both GET and POST logout are covered in development
and production cookie-scope regression cases. Staff/API regression suite: **271/271**
across 22 suites. No MFA, authorization or database restriction was weakened.

Final full-shell Chrome run: **10/10**, zero page exceptions, including successful
logout/reload after the fix. Scoped lint and release manifest checks pass.
Browser completion evidence and remaining hands-on gates are recorded in
[full-browser-local.md](full-browser-local.md). Safari/Firefox, real-provider OAuth,
hosted TLS/cookies and multi-instance/managed-database gates remain pending. Prior
backup/restore, older-snapshot and offline OAuth successes were not rerun.

## Current follow-up completion

Local follow-up work is complete. Draft PR [#293](https://github.com/nortonjulian/chatforia/pull/293)
was published with explicit approval. No deployment, merge, production access,
production data use or migration against an existing database occurred.
The earlier delivery record is retained below as historical evidence.
Current source commits are `09c514ac` (lint), `f5967c0d` (Users View/Edit),
`716b0181` (rehearsals), `672eb358` (restored MFA continuity),
`d16ada4f` (disposable CI bootstrap), and `fd64a584` (security review fixes).

| Follow-up check                                                                  | Actual result                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Selected server security/auth/API tests                                          | **269/269**, 22 suites; injected clients and unreachable loopback DB URL             |
| Users dialog, mounted Users page, staff dashboard and AdminRoute component tests | **20/20**, four suites                                                               |
| Fresh-cluster browser/backup/restore rehearsal                                   | **26/26** checks                                                                     |
| Actual Chrome browser checks                                                     | **17/17**, desktop and 390×844 viewport; zero page exceptions/external page requests |
| Cross-cluster restore/security checks                                            | **6/6**, including successful restored MFA and new token writes                      |
| Synthetic source setup/recovery evidence                                         | **3/3**                                                                              |
| Critical restored datasets                                                       | **14/14** matching row counts and SHA-256 fingerprints before post-restore writes    |
| Staff-project lint                                                               | Passed with zero allowed findings                                                    |
| Baseline-aware lint audit                                                        | **Zero branch-introduced errors or warnings**                                        |
| Client build                                                                     | Passed; external Sentry publishing disabled                                          |
| Reviewed migration/configuration verifier                                        | Passed; four SQL checksums unchanged, rollout template disabled                      |
| Full repository lint                                                             | Still fails: **384 errors, 2,609 warnings**, all retained baseline findings          |

The lint comparison uses pre-branch parent `4522e062`, checkpoint `e67c9ad2`,
previous delivery `85cb0557`, and the same repaired current rules for each.
The earlier 894-error count included 510 client-alias resolution false positives.
Two additional project defects exposed by newly checked Node ESM scripts were
fixed. Configuration guards still reject missing imports; no rule was disabled
or weakened. See [lint-investigation.md](lint-investigation.md) for methodology,
comparable counts, remaining configuration/source debt and exact commands.

## PR security review and new regressions

Reviewed the complete branch change set and traced authentication/MFA, reset and
operator recovery, staff grant/revoke, transaction locks/retries, current-session
checks, audit atomicity, runtime grants and the four manifest-listed migrations.
This is an engineering review, not independent penetration-test certification.

Concrete findings fixed in `fd64a584`:

- Startup now rejects runtime column/PUBLIC access to private signing, approval
  and replay tables; unsafe owner/recovery role attributes; missing/disabled audit
  and token-version rollback triggers. Trigger checks bind names to exact tables.
  Nine real synthetic drift cases reject startup and pass again after repair.
- React dialog removal lost the invoking button's keyboard focus. Native close
  plus explicit opener restoration now passes Tab/Shift+Tab/Escape browser checks.
- Owner bootstrap's unconditional `ALTER ROLE ... NOSUPERUSER` required a real
  superuser even for a restricted role. It now verifies the complete safe role
  attributes and rejects an unsafe existing role. All 159 migrations pass under
  a local non-superuser executor with explicitly scoped DBA owner membership;
  application roles remain restricted. No migration SQL/checksum was changed.

The final rehearsal passes 26 checks, including new stale-value browser conflict
rejection with no overwrite or success audit. Server tests remain 269/269; UI
component tests were rerun at 20/20. Scoped lint, same-rule lint audit (zero new
findings), and the read-only migration/config verifier pass. The PR workflow now
runs staff unit/API tests, scoped lint and the release verifier in addition to
its existing room tests and client build. Initial CI failed because its fresh
service lacked prerequisite roles; `d16ada4f` fixed setup and CI run 135 passed
129 server checks, five client checks and the build. See release-plan.md for the
current PR verification and approval boundary.

[CI run 136](https://github.com/nortonjulian/chatforia/actions/runs/41574812500)
completed successfully at `fd64a584`, including the 269 staff tests, scoped lint,
release verifier, 159 migrations, 129 room/server tests, five client tests and
production client build. The subsequent report update changes documentation only.

## Users View/Edit contract and evidence

The mounted Users list's previously inert buttons now have working handlers.
View fetches the selected user's current whitelisted details. No password hash,
MFA secret, recovery code/token, OAuth subject or session version is returned or
rendered. Both the API projection and UI field whitelist are tested.

Edit fetches current values and is authorized only for a current MFA-verified
global administrator. The only writable fields are `displayName`,
`preferredLanguage`, `showReadReceipts` and `showOriginalWithTranslation`.
There is no editable role, username, email, ban, credential, MFA or OAuth field.
No staff profile gained account-management permission. Staff with `users.read`
can View safe details through the staff API but receive no editing authority.

Every save validates the request, repeats current actor/session checks under
transaction locks, rejects founder/administrator/current or former staff/system
identities, detects stale current values, and commits the user change together
with `ADMIN_USER_PREFERENCES_UPDATED`. The returned committed safe record refreshes
the list. Cancel never saves. Unknown fields, role escalation and invalid values
are rejected; audit failure rolls back the update. The old unmounted role/flags/
ban/delete router was inspected and remains unmounted.

Browser assertions cover View, current-value loading, cancel, validation errors,
successful save/list refresh, direct role/protected-target denial, staff and
non-MFA denial, and session loss between form loading and saving. API regressions
also cover former staff/system targets, stale-value conflicts, field injection,
private response/error filtering and atomic audit failure rollback.

## Local restore scope and remaining gates

This follow-up did not contact an existing database. The runner initialized new
private source and restore clusters, generated an empty schema from Prisma,
installed security definitions only in the new source, populated synthetic data,
exported a custom-format logical backup plus password-free role globals, and
restored them into the new target. Both clusters stopped cleanly.

The final local run used PostgreSQL **16.13** and Chrome **156.0.8078.80**.
Source data, grant/revocation/session state, audits, consumed approvals and replay
registries survived restore. Restored runtime readiness, negative privilege tests,
replay rejection and positive MFA/token writes passed. The measured target setup,
restore and verification interval was **1,279 ms** on this fixture; this is not a
managed-service RPO/RTO guarantee. The fixture's encryption and signing keys were
retained separately in memory, not recovered from a production secret manager.

Machine evidence: `/tmp/chatforia-staff-unit-report.json`,
`/tmp/chatforia-staff-lint-audit.json`, and
`/tmp/chatforia-staff-local-rehearsal.json`. The final report records 26 passes,
both clusters stopped and private artifacts under
`/private/tmp/chatforia-staff-rehearsal-jstp5h`. Changes were tested before commit
`fd64a584`; the rehearsal correctly records parent `d16ada4f` and a dirty tree.
`node server/scripts/staff-migration-qa.mjs` separately passed the full history
under a provider-like non-superuser executor and rejected an unsafe owner.
Actual managed-service role/extension behavior is still a staging gate.

No authorized implementation work is blocked. The full-repository lint/release gate remains blocked by
pre-existing findings; the selected PR workflow has its own recorded results. The installed Firefox renderer failed
before opening a page on this host; Chrome completed the requested local cases.
Full-shell sign-in, Firefox/Safari, real HTTPS cookie/CORS origins, managed-service
role/backup/secret recovery, older-snapshot security reconciliation and staffed
observability/rollout checks remain explicit staging/manual gates in
[release-plan.md](release-plan.md). None of those environments was deployed or
accessed. Rollout remains on HOLD.

## Zero-additional-cost follow-up

QA-only commit `4df06df8` adds the missing local checks below.
The owner declined paid provisioning/spending. The paid staging proposal is
superseded by [staging-proposal.md](staging-proposal.md), with $0 additional cloud
budget and no existing infrastructure access. Production resources were untouched.
Already-passing 269/20/26 suites were not rerun without a source change.

New missing evidence completed locally: **53/53** offline OAuth callback/state,
web/mobile MFA enforcement, token signature/issuer/audience/nonce, reset-token
atomicity and serialization tests. Providers/Redis/database clients are mocked;
URLs fail closed at unreachable loopback port 1.

**Five** new synthetic older-snapshot/full-app checks pass: actual app-factory
password/TOTP/cookie staff access and admin denial; snapshot before real security
changes; explicit offline resurrection/replay hazard; fenced key/session/grant/
approval invalidation; rotated-key readiness and fresh MFA/token writes. Source
HTTP binds loopback; restored traffic is never reopened. Both new clusters stop.
External synthetic audits are retained; this is containment evidence, not a
complete production reconciliation/reopening procedure. No existing databases or
paid integrations are used. Reports: `/tmp/chatforia-staff-offline-auth-report.json`
and `/tmp/chatforia-staff-older-snapshot-report.json`.

Full browser-shell/UserContext, real OAuth console, Safari/Firefox/device,
independent-human recovery, actual secret-store and operational checks remain
human/access gates and need not inherently cost money. Actual DigitalOcean
managed-role/extension, provider backup/PITR and hosted proxy/network gates remain
unverified: no dedicated zero-cost provider sandbox has been identified. A new
logical database on production chatforia-db is explicitly not sufficient isolation.
No paid fallback is authorized. New QA scripts pass targeted lint; no application
security implementation or migration changes were made for this follow-up.

## Completed local older-snapshot reconciliation

Implementation/regression commit: `5b4205c0` (QA/CI only).

The earlier containment-only limit is superseded for the synthetic local case.
The extended older-snapshot rehearsal passes **10/10 checks**, including signed
complete post-backup evidence, atomic/idempotent import, preserved source/target
audit-ID collision lineage, replay/approval state, and current grants/revocations.
Session floors are above the source's post-backup versions, not just the older
snapshot's values. Tampered/incomplete evidence, missing actual replay/approval
rows, unapproved active grants, changed audit payloads and partial credential
recovery all block reopening. A real not-null failure in the mandatory audit
rolls back imported records, authority, version floors and the private QA ledger.

All protected fixture identities, including the founder, receive new password
and MFA through fresh independent issuer/executor approvals before the local
gate opens. Real loopback HTTP denies snapshot passwords, the superseded
post-backup password, old TOTP, backup codes and old sessions. Legitimately
recovered ACCESS_ADMIN access succeeds only after new MFA and stays within its
profile; revoked staff remains denied even with a current ordinary MFA session.
A consumed assertion resigned with a current key/current actor version is still
rejected, so the revoked grant cannot be revived by replay.

The current report records `trafficReopened: true` for the controlled loopback
probe only, `productionAccessReopened: false`, and both clusters stopped.
Local artifacts: `/private/tmp/chatforia-staff-rehearsal-yDED6b`; report remains
`/tmp/chatforia-staff-older-snapshot-report.json`. Detailed prerequisites and
instructions: [older-snapshot-recovery.md](older-snapshot-recovery.md).
Actual provider recovery, secret-store custody and human identity verification
remain pending; no spending, production access or deployment is authorized.
The reconciliation/ledger/gate code is QA-only and creates no application route,
runtime grant or production migration. The four security SQL hashes are unchanged.

## Initial delivery record — historical

The following original results describe the earlier delivery and are not claims
that those existing-database checks were rerun during this follow-up.

Branch: `feature/staff-access-rbac-20261102`. Original checkpoint: `e67c9ad2`.
Reviewed implementation through `20f0cd4c`; release tooling and component-test
additions accompany this record. Verification date: 2026-11-02.

No applicable AGENTS.md was present in this worktree or its parent directories
when work began. Existing implementation, tests, and both untracked migration
drafts were retained and extended. No reset, clean, worktree replacement, push,
merge, deployment, persistent migration application, or production change was
performed.

### Stage results

| Stage                                 | Result                                                                      | Evidence                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 — protected authentication/recovery | Complete locally                                                            | Signed MFA challenge/attempt/completion writes; single-use backup codes; independent operator recovery bound to target, action and exact replacement value; session invalidation; mandatory recovery audit; verified MFA retained in short API tokens.                                                                                          |
| 2 — runtime database compatibility    | Complete locally                                                            | All four pending definitions execute together only within a rolled-back Prisma transaction; ordinary user CRUD, reset-token writes and MFA remain compatible; runtime role cannot write protected credentials/assignments/audits or create ADMIN users.                                                                                         |
| 2 — integrated acceptance             | Complete locally                                                            | Existing 8-group/185-test checkpoint independently reproduced; expanded suite passes 9 groups, 242 Jest tests and 39 integrated checks.                                                                                                                                                                                                         |
| 3 — adversarial QA                    | Complete within isolated scope                                              | Missing/tampered/non-MFA JWTs; revocation/session loss; signed assertion/challenge/backup-code/approval replay; expired and retargeted recovery; direct SQL rejection; forced audit failure rollback; real competing database lock transactions and service retry tests.                                                                        |
| 4 — authenticated dashboard/APIs      | Complete locally                                                            | `/staff` UI and permission-scoped APIs for users, reports, staff assignments, access history, grant/change/revoke, and report resolution. Actor and session data come from real authentication. Mutations repeat authorization in transactions. Browser CSRF is required with cookie authentication, including when a Bearer header is present. |
| 5 — hardening/readiness               | Local hardening and release packet complete; repository CI gate remains red | Startup enforces role/schema/table/function/trigger boundaries, distinct keys, matching DB verification key, and explicit production cohort. Disabled configuration, reviewed SQL checksums, recovery and containment/rollback procedures are prepared.                                                                                         |
| 6 — controlled rollout preparation    | Complete; rollout NOT started                                               | Two independent default-off flags, bounded production allowlist, canary/observation/stop criteria, named-owner approval template and rollback constraints. No cohort or production operators were provisioned.                                                                                                                                  |

### Acceptance criteria

- **Protected authorization:** real JWT verification and current database user,
  token version, MFA and assignment checks precede staff access. Grant/revoke
  services repeat eligibility/delegation authorization under deterministic locks.
  Founder and global administrator identities cannot be delegated through these
  APIs; CTO and ACCESS_ADMIN remain outside delegated target profiles.
- **Database privilege isolation:** runtime cannot inherit the security owner or
  recovery roles, update global role/ID, forge protected staff history, alter
  protected credentials or token rows, or use TRUNCATE/trigger/schema privileges
  to bypass row protection. Protected mutations use narrowly scoped functions.
- **Alternative escalation paths:** ADMIN INSERT and direct role writes are denied;
  active and former staff/founder identities retain protection. Public reset
  tokens cannot replace protected credentials. Recovery requires independent
  session identities, a short-lived single-use approval and an exact value hash.
  Cookie-only CSRF and cookie-plus-Bearer bypass attempts are rejected.
- **Integrated verification:** actual Prisma runtime-role queries, PostgreSQL
  security functions/triggers, real JWT/CSRF HTTP requests, UI component tests
  and client build all pass the scoped checks below.

### Verified results and limits

| Check                                                      | Result                                |
| ---------------------------------------------------------- | ------------------------------------- |
| Original checkpoint QA/Jest baseline                       | 8/8 groups; 185/185 tests reproduced  |
| Expanded staff-security acceptance                         | 9/9 groups                            |
| Selected server security/auth/API Jest tests               | 242/242 across 21 suites              |
| Integrated SQL/Prisma/JWT/CSRF/API checks                  | 39/39                                 |
| Staff dashboard + legacy AdminRoute component tests        | 9/9                                   |
| Client production build                                    | Passed                                |
| New staff implementation/test lint (`lint:staff-security`) | Passed, zero lint errors/warnings     |
| Reviewed migration/configuration verifier                  | Passed                                |
| Repository-wide lint                                       | FAILED: 894 errors and 2,793 warnings |

The missing lint plugins and incompatible flat-config entries were fixed so lint
can run. The repository-wide lint result is not claimed green. Its broader code
issues remain a release/CI blocker; they are not evidence of failing staff
acceptance tests. Full-repository Jest was not run because unrelated suites use
broad database reset helpers; preserving existing isolated QA data takes priority.

Database testing was restricted to local `127.0.0.1:5432`, database
`chatforia_staff_access_test_20261102`, with verified database/session identity and
collision guards. All pending migration definitions, test-only roles, fixtures,
approvals, secret replacements and account/audit mutations were inside a rolled-
back transaction. Persistent migration history remains 155 applied migrations,
with the four manifest-listed migrations pending. PostgreSQL test sequences may
advance during rolled-back inserts; no production resources were contacted.

Concurrency evidence covers actual competing sessions on the shared coordination
lock and unit coverage for serialization-conflict retries. It is not a production
load test or a staged deployment/restore rehearsal. Real HTTP acceptance covers
authentication, permissions, CSRF, report atomicity, grant and session loss;
component tests cover the dashboard UI. A full browser/staging soak remains a
future release gate, not an authorized rollout action in this assignment.

The QA runner writes machine-readable summaries to
`/tmp/chatforia-staff-qa-report.json` and
`/tmp/chatforia-staff-jest-report.json`. Repository-wide lint details are in
`/tmp/chatforia-staff-repository-lint.log`; the client build log is in
`/tmp/chatforia-staff-client-build.log`. These logs contain no configured secrets.

### Local commits

| Commit     | Deliverable                                                                |
| ---------- | -------------------------------------------------------------------------- |
| `e67c9ad2` | Preserved foundation checkpoint                                            |
| `9e929673` | Protected authentication, runtime permissions and independent recovery     |
| `624dcca1` | Startup privilege/configuration readiness                                  |
| `537b6223` | Authenticated staff dashboard, APIs and initial tests                      |
| `1ea5f0bb` | MFA proof retained in short API sessions                                   |
| `4810ee16` | Rollback-only integrated/adversarial QA                                    |
| `20f0cd4c` | CSRF closure, real HTTP acceptance, DB-key matching and canary enforcement |

The final local release-packet commit adds this record, the manifest, disabled
configuration template, read-only verifier, lint-tooling repairs and expanded UI
tests. See `release-plan.md` for future environment approval, operator provisioning,
restore rehearsal, canary rollout and containment requirements. Those actions
remain on HOLD and require separate explicit authorization.
