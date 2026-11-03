# Local synthetic browser and restore rehearsal

This is a local fixture rehearsal, not a deployment or a production backup test.
The runner accepts no database URL, existing data directory, input archive or
production dataset. It always initializes two new private temporary PostgreSQL
clusters, verifies their data-directory identity before writes, and stops them
when finished. Existing PostgreSQL servers and database history are untouched.

## Reproducible scope

- `npm run test:staff-unit`: selected security/authentication/API regressions with
  injected clients. Both database environment variables point to unreachable
  loopback port 1, so accidental database access fails closed.
- `npm run qa:staff-local`: initialize an empty source cluster, generate schema
  SQL from the repository's Prisma datamodel, install staff-security definitions
  only in that new cluster, and create synthetic users, assignments and reports.
  This does not run migrations against any existing database.
- Launch installed Chrome through Playwright with a fresh temporary browser
  profile. Serve the actual StaffDashboard and UsersTable components through a
  minimal Vite harness, and use the actual authentication, CSRF and protected APIs
  against the synthetic runtime role. No production UI or API host is used.
- Run the browser cases below, take a custom-format `pg_dump` and a
  `pg_dumpall --roles-only --no-role-passwords` export, then restore into the second
  newly initialized cluster using `pg_restore --exit-on-error --single-transaction`.
- Compare row counts and SHA-256 fingerprints for 14 critical account, report,
  token, approval, staff-event and audit datasets before any post-restore writes.
  Verify runtime readiness, direct-write denial, stale sessions and consumed
  authorization/recovery replay rejection. Exercise positive protected MFA with
  newly allocated token records using the separately retained synthetic keys.

The runtime role is `chatforia_dev`; owner/recovery groups remain separate and
NOLOGIN. Synthetic operator session identities approve and consume one bound
credential-recovery approval before the backup, so approval/event persistence is
checked with nonempty data. No real operator identity or credentials are used.

The source and restore clusters use the same newly created bootstrap identity.
PostgreSQL 16 preserves membership `GRANTED BY` provenance, so replaying globals
under a different bootstrap identity initially failed. The runner now preserves
that provenance and omits only the one duplicate bootstrap `CREATE ROLE` in the
new target; role attributes, memberships, object owners and ACLs are restored.
This is not permission weakening or a generic recipe for changing live roles.

The database archive contains only synthetic records. Directories are private
(mode 0700); diagnostic/report files are mode 0600. Signing/encryption keys and
JWTs are generated for this process and never printed, stored in browser traces,
or checked into Git. No password hashes, MFA secrets, recovery tokens or database
URLs with passwords are rendered by the UI. Temporary artifacts remain private
for review; the PostgreSQL processes are stopped. No database directories are
reset, reused or dropped by the runner.

## Browser assertions

Chrome desktop and a 390×844 viewport exercise:

1. Anonymous and non-MFA staff sessions show no protected data/controls.
2. Staff navigation is permission-filtered; user pagination works, untrusted
   username text is escaped and the mobile document stays horizontally bounded.
3. Read-only staff View opens only permitted current details and has no editor.
4. Support report resolution uses real cookie/CSRF authentication, persists the
   resolution and one audit, and cannot read the access-audit API.
5. Administrator Users View opens the selected current record, without any
   credential, MFA secret or recovery material in the response or display.
6. Edit loads current values. Cancel leaves database values and audit count intact.
7. Invalid language input displays the server's validation error without saving.
8. Save changes only the explicit preference fields, refreshes the displayed
   selected record and produces one atomic success audit.
9. Role escalation is rejected by the API; founder, staff and administrator
   identity edits have no save controls and are rejected by direct API requests.
10. Staff-only and non-MFA administrator sessions cannot load the admin Users list.
11. Session loss after opening an editor denies save and removes editing controls.
12. An authorized empty access-audit view renders correctly.
13. Staff profile options stay in delegated scope; native ID validation and
    disabled in-flight controls work; a real profile change invalidates sessions.
14. Real revocation invalidates an already-open browser session on its next protected request and clears its UI.
15. Turning off only the dashboard leaves protected MFA operational. No page
    exceptions or external page requests occur.

The application shell and real password/OAuth sign-in are not mocked
into this result: the harness mounts the production components directly and
mints synthetic signed session cookies. Their server verification is real.
Full-shell sign-in and hosting-origin behavior are listed as staging checks in
`release-plan.md`; no claim is made that this harness covers them.

## Host requirements and evidence

The final run passed all 23 checks: 15 browser checks, six restore/security
checks and two source/setup checks. The recorded restore/setup/verification
interval was 1,464 ms. The extra restored-MFA assertion was tested before its
commit (`672eb358`), so its report identifies parent `716b0181` and a dirty
working tree; no uncommitted production logic was involved.

The successful host uses PostgreSQL 16.13 and Chrome 156.0.8078.80. PostgreSQL
utilities are selected from `/usr/local/opt/postgresql@16/bin`, or an explicitly
supplied `STAFF_QA_PG_BIN` directory. No global database environment is reused.
The initial installed Firefox attempt failed in the macOS renderer/content
sandbox before opening a page; its temporary source cluster was stopped. Chrome is the
verified engine. Firefox on a supported host and Safari/WebKit remain manual
cross-engine checks; no Firefox sandbox bypass was used. Chrome used a fresh test profile and standard Playwright launch settings.

Current machine results are `/tmp/chatforia-staff-local-rehearsal.json`,
`/tmp/chatforia-staff-unit-report.json` and the private artifact directory named
by the former report. That directory contains screenshots, synthetic dump/globals
files and `restore-evidence.json` with dataset digests and local timing. Failed
attempts have separate private diagnostic directories and do not overwrite or
reuse database clusters.

The measured local restore time includes initialization of the new restore
cluster, restoration and verification. It is not an RPO/RTO promise for a managed
staging or production database. External encryption/signing-key recovery, actual
backup retention, managed-service roles and operational alert routing still need
an approved environment rehearsal with synthetic data.

During the final documentation review, the saved machine report was inspected
and all 23 named checks were confirmed passed, including Users save/cancel,
validation/denials and successful restored MFA with fresh token/sequence writes.
Both clusters report stopped. No repeat database setup was needed for this
documentation-only change; component regressions were rerun separately.

## PR review follow-up (supersedes the 23-check run above)

At the `fd64a584` implementation, the final new-cluster run passed **26/26**:
17 Chrome browser, six restore/security and three source/setup/drift checks.
Nine injected private-column/PUBLIC grants, replay writes, role-attribute and
trigger-disable cases all rejected startup, then passed after exact restoration.
Chrome Tab/Shift+Tab navigation, Escape cancellation and return of focus to the
invoking Edit button passed after the dialog cleanup fix. A concurrent preference
writer produced a browser-visible conflict with no overwrite or success audit.

The report identifies parent `d16ada4f` with dirty source subsequently committed
as `fd64a584`. Artifacts: `/private/tmp/chatforia-staff-rehearsal-jstp5h`;
restore/initialization/verification interval: **1,279 ms**. Both clusters stopped.
All 14 dataset fingerprints, positive restored MFA/new token writes and replay
and direct-write denials passed again. The report path remains
`/tmp/chatforia-staff-local-rehearsal.json`.

`node server/scripts/staff-migration-qa.mjs` additionally initialized a fresh
cluster and applied all 159 migrations through a non-superuser DBA executor.
An unsafe pre-existing owner was rejected. Only the DBA executor received owner
SET authority; runtime/recovery roles retained their restrictions. PostgreSQL 16
would not revoke the executor membership without dependent-grant handling; no
CASCADE was used. Actual DigitalOcean role/extension and backup/key compatibility
remain the staging proposal's explicit preflight, not a local certification.
