# Staff-security acceptance record

## Current follow-up completion

All authorized local follow-up work is complete. No push, deployment, merge,
production access, production data use or migration against an existing database
occurred. The earlier delivery record is retained below as historical evidence.
Current source commits are `09c514ac` (lint), `f5967c0d` (Users View/Edit),
`716b0181` (rehearsals), and `672eb358` (restored MFA continuity).

| Follow-up check                                                                  | Actual result                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Selected server security/auth/API tests                                          | **269/269**, 22 suites; injected clients and unreachable loopback DB URL             |
| Users dialog, mounted Users page, staff dashboard and AdminRoute component tests | **20/20**, four suites                                                               |
| Fresh-cluster browser/backup/restore rehearsal                                   | **23/23** checks                                                                     |
| Actual Chrome browser checks                                                     | **15/15**, desktop and 390×844 viewport; zero page exceptions/external page requests |
| Cross-cluster restore/security checks                                            | **6/6**, including successful restored MFA and new token writes                      |
| Synthetic source setup/recovery evidence                                         | **2/2**                                                                              |
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

The follow-up evidence was re-inspected at `672eb358`; scoped lint and the
read-only migration verifier were rerun successfully. Browser/restore results
are retained machine evidence from the unchanged implementation, not a new
browser run. The four-file documentation update makes no application changes.

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
restore and verification interval was **1,464 ms** on this fixture; this is not a
managed-service RPO/RTO guarantee. The fixture's encryption and signing keys were
retained separately in memory, not recovered from a production secret manager.

Machine evidence: `/tmp/chatforia-staff-unit-report.json`,
`/tmp/chatforia-staff-lint-audit.json`, and
`/tmp/chatforia-staff-local-rehearsal.json`. The last contains 23 passed checks and
points to private screenshots/dump/globals and `restore-evidence.json` under
`/private/tmp/chatforia-staff-rehearsal-o5QCCp`. The extra restored-MFA assertion
was tested in the working tree and then committed as `672eb358`; its report
correctly records parent `716b0181` with a dirty working tree. See
[local-rehearsal.md](local-rehearsal.md) for the harness boundary and safety guards.

No authorized implementation work is blocked. Release/CI is still blocked by
pre-existing repository lint findings. The installed Firefox renderer failed
before opening a page on this host; Chrome completed the requested local cases.
Full-shell sign-in, Firefox/Safari, real HTTPS cookie/CORS origins, managed-service
role/backup/secret recovery, older-snapshot security reconciliation and staffed
observability/rollout checks remain explicit staging/manual gates in
[release-plan.md](release-plan.md). None of those environments was deployed or
accessed. Rollout remains on HOLD.

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
