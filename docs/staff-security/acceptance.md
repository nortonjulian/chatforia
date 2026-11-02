# Staff-security acceptance record

Branch: `feature/staff-access-rbac-20261102`. Original checkpoint: `e67c9ad2`.
Reviewed implementation through `20f0cd4c`; release tooling and component-test
additions accompany this record. Verification date: 2026-11-02.

No applicable AGENTS.md was present in this worktree or its parent directories
when work began. Existing implementation, tests, and both untracked migration
drafts were retained and extended. No reset, clean, worktree replacement, push,
merge, deployment, persistent migration application, or production change was
performed.

## Stage results

| Stage                                 | Result                                                                      | Evidence                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 — protected authentication/recovery | Complete locally                                                            | Signed MFA challenge/attempt/completion writes; single-use backup codes; independent operator recovery bound to target, action and exact replacement value; session invalidation; mandatory recovery audit; verified MFA retained in short API tokens.                                                                                          |
| 2 — runtime database compatibility    | Complete locally                                                            | All four pending definitions execute together only within a rolled-back Prisma transaction; ordinary user CRUD, reset-token writes and MFA remain compatible; runtime role cannot write protected credentials/assignments/audits or create ADMIN users.                                                                                         |
| 2 — integrated acceptance             | Complete locally                                                            | Existing 8-group/185-test checkpoint independently reproduced; expanded suite passes 9 groups, 242 Jest tests and 39 integrated checks.                                                                                                                                                                                                         |
| 3 — adversarial QA                    | Complete within isolated scope                                              | Missing/tampered/non-MFA JWTs; revocation/session loss; signed assertion/challenge/backup-code/approval replay; expired and retargeted recovery; direct SQL rejection; forced audit failure rollback; real competing database lock transactions and service retry tests.                                                                        |
| 4 — authenticated dashboard/APIs      | Complete locally                                                            | `/staff` UI and permission-scoped APIs for users, reports, staff assignments, access history, grant/change/revoke, and report resolution. Actor and session data come from real authentication. Mutations repeat authorization in transactions. Browser CSRF is required with cookie authentication, including when a Bearer header is present. |
| 5 — hardening/readiness               | Local hardening and release packet complete; repository CI gate remains red | Startup enforces role/schema/table/function/trigger boundaries, distinct keys, matching DB verification key, and explicit production cohort. Disabled configuration, reviewed SQL checksums, recovery and containment/rollback procedures are prepared.                                                                                         |
| 6 — controlled rollout preparation    | Complete; rollout NOT started                                               | Two independent default-off flags, bounded production allowlist, canary/observation/stop criteria, named-owner approval template and rollback constraints. No cohort or production operators were provisioned.                                                                                                                                  |

## Acceptance criteria

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

## Verified results and limits

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

## Local commits

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
