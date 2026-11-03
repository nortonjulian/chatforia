# Real Google OAuth local rehearsal — verified 2026-11-03

The optional launcher `server/scripts/staff-google-oauth-local.mjs` uses a private
owner-only credential file outside the repository, a new verified PostgreSQL
cluster, newly spawned authenticated loopback Redis, fresh application/signing keys
and actual Google Passport callbacks. Paid routes remain closed. Secret-bearing
application logs are suppressed; optional request diagnostics record only boolean
cookie/header validity, fixed route names, origin classification and status codes.
No credential, authorization code, JWT, CSRF value or TOTP value is logged.

## Observed failure and fix

On 2026-11-03 the user completed a real Google callback, prepared the synthetic
SUPPORT fixture and retried Chatforia MFA. The running helper had already verified
a signed current pending cookie, an unexpired/unconsumed challenge and pre-MFA
staff/admin denial. Read-only database inspection confirmed fixture 3 was linked,
MFA-enabled, active SUPPORT, and at token version 1. All three challenge records
remained unused with zero failed-code attempts; they had expired by inspection.

The exact failing request is `POST /auth/2fa/login` from the server-rendered page
at `http://localhost:5002/auth/2fa/challenge`. Its browser Origin is
`http://localhost:5002`, which the old application CORS allowlist rejected.
`createCorsForbiddenError()` returned 403 (`CORS_ORIGIN_FORBIDDEN`), normalized to
`error: Forbidden`, before CSRF or MFA code validation ran. Reproducing the same
request Origin produced that response. Allowed frontend Origin/no Origin instead
reached the separate CSRF rejection (`reason: csrf`), identifying the earlier check.

The application now adds only `http://localhost:5002` to development CORS origins.
Production origins are identical to the previous list; no wildcard/reflection,
CSRF exemption, MFA bypass, privilege or database change was introduced.
After evidence capture the exact allowlist change was applied to the running local
process without restarting/resetting its PostgreSQL, Redis, keys, cookies, prepared
fixture or observer state. A temporary loopback debugger was then closed and its
closure verified. The source change is in `server/middleware/cors.js` and
`server/app.js`, so subsequent local launches use the same policy.

## Focused verification

- 2/2 targeted CORS unit tests pass, including development-only origin acceptance
  and unchanged production origins.
- 4 running-app check groups pass: API-origin CSRF bootstrap; missing/invalid CSRF
  rejection; valid cookie/header reaching the MFA handler without authenticating
  a missing challenge; foreign and unrelated localhost origins still rejected.
- Redacted diagnostics confirm valid CSRF reached the handler (400 Missing fields),
  missing/invalid headers remained 403 CSRF, and foreign origins were rejected
  before CSRF. Focused lint and diff checks pass. No completed broad suites rerun.
- Evidence: `/tmp/chatforia-oauth-forbidden-evidence.json`,
  `/tmp/chatforia-google-cors-report.json`,
  `/tmp/chatforia-oauth-request-diagnostics.json` and
  `/tmp/chatforia-google-oauth-report.json` (all owner-only).

## Completed real-provider result

The owner completed the browser flow after the CORS fix. The independently read
local observer report has `realGoogle`, `preMfaDenied`, `postMfaSupport`,
`adminDenied`, `logoutDenied` and `completed` all true. Before MFA, protected staff
and admin endpoints returned 401. After MFA, the actual SUPPORT session returned
200 and the administrator endpoint returned 403. After an observed application
logout, staff, admin and session endpoints all returned 401.

The redacted successful `POST /auth/2fa/login` diagnostic independently confirms
status 200, API Origin, pending-cookie/body agreement, and a valid CSRF header and
secret cookie. This was a real Google callback and human browser sign-in, not a
mocked OAuth result. Sanitized durable evidence is
[evidence/google-oauth-local-20261103.json](evidence/google-oauth-local-20261103.json).
No credential, provider subject/email, authorization code, cookie, token, MFA seed
or TOTP value is included in that evidence.

This closes the local real-Google → Chatforia MFA → SUPPORT authorization/logout
gate for the tested flow. It does not close Apple OAuth, deployed HTTPS/proxy/domain
cookies, managed database/backup/PITR, actual secret-store/operator recovery,
independent release review or remaining device/accessibility gates.

## Rehearsal procedure (reference only; completed above)

Keep the same private window/helper. Do not click Prepare Support again. Open
`http://localhost:5173`, start Continue with Google again with the configured QA
identity, and use the fresh pending challenge. On reaching Chatforia MFA, check
access in the helper before submitting its fresh `qa_support` authenticator code.
After success check SUPPORT 200 / ADMIN 403, then log out through Chatforia and
check both protected endpoints return 401. Old challenges have expired and cannot
be repaired by entering a newer TOTP code.

No production access, existing-database migration, spending, merge or deployment.


## Reusable local setup

- Run `python3 server/scripts/staff-google-oauth-save.py` in your own interactive
  Terminal to enter the development client ID/secret (twice) and the QA Google
  email using hidden input. The file is written outside the checkout under
  `/private/tmp/chatforia-dev-oauth-<uid>/dev-client.json`, with directory 0700 /
  file 0600. Existing files are never overwritten; no values enter shell history.
- The launcher expects `/tmp/chatforia-redis-build.json` containing the absolute
  `binary` path of a locally available Redis Open Source server. The observed
  run used Redis 8.10.2 built from the official redis-stable source under a private
  temporary directory; no system service, cloud Redis or paid resource was created.
  The launcher spawns its own empty authenticated loopback instance and checks
  server PID identity. Never point this test at an existing Redis/database service.
- Run `node server/scripts/staff-google-oauth-local.mjs` from this worktree. Ports
  5173/5002 must be free. PostgreSQL uses the installed PG16 tools and a fresh
  verified cluster; runtime privileges and security-readiness checks remain active.
- Browser actions happen through the fresh helper URL in the owner-only session
  metadata. Linking occurs before the fixture is protected; Prepare Support
  increments its session version and invalidates the first pending challenge.
- Automatic shutdown is four hours after startup; SIGTERM to the exact current
  harness PID also stops only its owned PostgreSQL/Redis processes. Credentials
  remain private outside the repository; do not publish raw temporary artifacts.
