# Zero-cost full application browser rehearsal

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
credentials. It refreshes every 10 seconds; submit a fresh code within its 30-second
window. Each start generates new accounts/passwords/secrets. The source cluster is
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

The synthetic session was left running at `http://localhost:5173`, automatically
expiring at **2026-11-03 09:45 UTC** (02:45 MST). Use the helper URL in the session
metadata for current generated passwords/codes. This time-limited URL is local
only; a later start changes the helper URL and accounts.

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

Safari/Firefox results remain pending until a human performs these steps. Chrome
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
