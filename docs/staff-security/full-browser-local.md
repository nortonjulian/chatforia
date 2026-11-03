# Zero-cost full application browser rehearsal

Update: the owner reports Safari **and** Firefox passes for admin login/MFA, View,
Cancel, Save with a reason, persistence after reload, and logout/Back/reload denial.
These are user-reported passes, not automation; see [current checkpoint](checkpoint-20261103.md).

Start from the repository root with `node server/scripts/staff-shell-local.mjs`.
This creates a new synthetic PostgreSQL cluster; it accepts no existing database
URL or dump. The runtime role retains the staff migrations' privilege restrictions.
Only the new cluster receives generated schema and synthetic accounts. Developer
dotenv files and cloud/provider credentials are not inherited. Port 5173 must be
free: the harness fails rather than stopping an existing listener.

The actual client index/main, App, UserContext, BrowserRouter, LoginForm and Users
components run against the actual app factory and restricted runtime database.
No session cookie, JWT, currentUser, login response or Users API response is mocked.
CSRF remains enabled (development mode). In-memory Redis/session storage is local
QA infrastructure, not evidence for production Redis or multi-instance behavior.
Socket.IO is not started; realtime/call features are outside this staff rehearsal.
A local CSP blocks external requests; unrelated/paid API routes are unavailable.
Do not change browser security settings or install provider credentials.

The running session metadata is `/tmp/chatforia-staff-shell-session.json` (0600).
It contains the app URL, private random account-helper URL, PID, expiry and artifact
location, without passwords, TOTP seeds, JWTs or recovery tokens. The account helper
shows generated synthetic passwords and current MFA codes only. Never use real
credentials. The helper polls its loopback code endpoint every second, shows remaining time,
and withholds codes near expiry. It clears codes while hidden or after a failed
refresh; focus/visibility triggers a new fetch. Code nodes stay stable for copying.
Submit a fresh code promptly after returning to the helper tab. Each start generates new accounts/passwords/secrets. The source cluster is
stopped automatically after four hours, or by interrupting the launcher. To stop
from another terminal, send SIGTERM to the exact PID in that session metadata.
Files are retained for review; no existing files/databases are deleted.

## Verified full-shell run

The final fresh-cluster Chrome run passed **10/10** checks, with zero page
exceptions (`completed: true`, `tailOnly: false`). Evidence:
`/tmp/chatforia-staff-shell-report.json`, artifacts
`/private/tmp/chatforia-staff-rehearsal-nGey7Y`.

Covered anonymous protected deep-link routing, administrator password-to-MFA,
real UserContext bootstrap after reload, selected-user View, Cancel, invalid
missing-reason save, successful protected API/database save and row refresh,
logout clearing the session across reload, ordinary-user password-to-MFA and
routing/API administrator denial. Successful saves used the actual protected API;
no auth or Users response was intercepted or fabricated.

The browser exposed a real configured-cookie logout defect. Commit `b2259dca`
clears that cookie using its issuing scope before legacy alias cleanup. The final
browser run includes this fix; 271/271 staff/API regressions pass. Scoped staff
lint and migration checksum/configuration verification pass. Targeted auth-file
lint still has exactly its baseline 2 errors/35 warnings; test-file lint is clean.
Rule/message/severity comparison found no new findings. Full repository lint was
not repeated; its previously recorded blocker remains unresolved.

That full-shell run's synthetic session was subsequently stopped during the helper
follow-up. Use `/tmp/chatforia-staff-shell-session.json` for the current live URL,
helper capability, PID and expiry; old helper URLs/passwords are not current.

## Helper/MFA freshness follow-up

A direct probe of the previous running environment accepted a newly fetched helper
code (200), rejected replay of that completed challenge (401), and found no
persistent helper/enrollment-secret mismatch. The exact reported failed submission
was not captured, so its cause cannot be proved retrospectively. The old helper's
static rendered codes and background meta-refresh provided no reliable freshness
indicator; an expired five-minute challenge can also reject a fresh TOTP code.

The local helper now polls a no-store endpoint using explicit server time. It hides
codes near expiry, when hidden, when refresh fails, or when its last snapshot is
stale. Refresh/focus restores codes without exposing MFA seeds or recovery tokens.
It explains five-minute/single-use challenge expiry and the five-attempt limit.
MFA verification, accepted time window, signing and replay restrictions are unchanged.

Use `node server/scripts/staff-shell-local.mjs --helper-check` for only the affected
helper/login checks; the default launcher retains the full-shell suite. Synthetic
code/time boundary tests run with
`node --test server/scripts/staff-shell-helper.test.mjs`. Targeted browser evidence
is `/tmp/chatforia-staff-helper-report.json`. Three helper UI checks passed; the
initial cold application load exceeded the harness's input wait, so it did not
complete the login portion. The runner now waits explicitly for the real login
screen. A login-only continuation passed **5/5** checks in
`/tmp/chatforia-staff-helper-login-report.json` (`completed: true`): password requires
MFA, wrong code denied, fresh helper code accepted through the actual browser,
consumed challenge rejected (401), and a new independent challenge succeeds (200).
The three pure code/time-boundary tests and scoped staff lint also pass. No Users,
restore, or full staff suite was repeated for this helper-only change.

The current synthetic instance uses artifacts
`/private/tmp/chatforia-staff-rehearsal-rR9QL8` and is left running for manual tests.
Its scheduled shutdown is **2026-11-03 10:12 UTC** (03:12 MST).

**After a harness restart, discard every old login challenge and old password.**
Open a new private window (or fully reload the application to load its current API
address), open the helper URL from the current session metadata, choose **Start over**
if a verification form remains, enter the new generated password, then
fetch the code for `qa_admin` again. Old MFA pages retain tokens signed by the
previous synthetic instance and cannot be repaired by entering a newer code.

## Safari and Firefox: exact hands-on checklist

Run in each browser separately using a fresh private window with normal security
settings. Open the account helper in a second tab. Record browser/OS version, time,
PASS/FAIL and any screenshot without passwords/codes.

1. Open `/admin/users` signed out: expect login and no user records. Enter an
   incorrect password once: expect an error and no authenticated shell.
2. Use `qa_admin` and its generated password. Expect the verification-code screen.
   Enter `000000` once (unless that happens to be the displayed code): expect denial.
   Enter a fresh code from the helper: expect the authenticated application shell.
3. Open `/admin/users`, reload, and confirm the admin shell and list persist.
   Find `qa_user`; **View** must show that selected user's permitted details.
   Close/Escape must dismiss the dialog and restore focus to its opener.
4. **Edit** `qa_user`: current values must load. Change display name, **Cancel**,
   reopen and verify it was not saved. Attempt **Save changes** without a reason:
   expect validation and the dialog to remain open. Supply a reason of at least
   five characters, save, and verify both the row and reopened View reflect it.
   There must be no editable role, password, MFA secret or recovery-token field.
5. Edit `qa_admin`/`qa_founder`: expect a protected/read-only identity and no save
   form. Log out, use Back/reload: expect login without recovered admin access.
6. Sign in with `qa_support` plus its fresh MFA code; open `/staff`, select Users,
   and View `qa_user`: permitted details, no Edit/save. `/admin/users` must not
   reveal the list. Log out. Sign in with `qa_user` plus MFA and verify both
   `/staff` and `/admin/users` deny access. Log out and close private windows.

The six reported administrator flows are recorded as user-reported Safari/Firefox
passes. Other checklist steps remain outside that reported scope. Chrome
automation is not a substitute for WebKit/Firefox, screen-reader, mobile device,
production cookie/domain/TLS, accessibility or hosted deployment testing.

## OAuth boundary

Google and Apple are unconfigured and disabled in this harness. Existing offline
OAuth tests use mocked provider responses; they verify application state/signature
handling, not provider consent, redirects, real accounts or provider delivery.
Real Google/Apple sandbox sign-in requires separately authorized provider test-app
configuration and a human test account. No real-provider verification is claimed.

Automated full-shell evidence is `/tmp/chatforia-staff-shell-report.json`;
`completed` must be true before calling that run fully passed. Earlier component,
recovery, backup/restore and offline OAuth checks were not rerun for this task.
