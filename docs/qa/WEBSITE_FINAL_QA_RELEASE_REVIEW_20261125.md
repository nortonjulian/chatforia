# Website final QA — local release review, November 25

## Review candidate

- Worktree: `/Users/juliannorton/Desktop/chatforia-web-final-qa-release-review-20261125`
- Branch: `release/web-final-qa-review-20261125`
- Base: refreshed `origin/main` at `d189cf65`
- Status: local review only; not pushed, merged, or deployed.

The eight original website checkpoints remain intact in
`/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124`
at `8f812f7c`. The candidate replays their website corrections as follows:

| Original checkpoint | Review commit | Scope |
| --- | --- | --- |
| `8a88d17b` | `401b6190` | Memory-only native conversation snapshots and accessible MMS images |
| `4ae450b5` | `99951d61` | Eight approved theme tokens and parity evidence |
| `64b43bcc` | `50da1248` | Socket/online authoritative refresh and rendered-theme evidence |
| `d0aea91f` | `9c776b55` | Native/MMS inline image parity |
| `8bab90e5` | `6c6eab7c` | Shared authenticated image viewer and gallery/download behavior |
| `aa666e3d` | `f21dba04` | Responsive composer and Help placement |
| `f2d5d539` | `7289ea45` | New SMS/MMS composition; obsolete account-66 handoff excluded |
| `8f812f7c` | `03a46870` | Shared viewer desktop/mobile sizing, header Close and short-screen caption/Download fit |

The candidate changes no backend, migration, MLS, native, or deployment-workflow
files. `git diff --quiet 8f812f7c HEAD -- client` exited 0: the candidate's
client tree is byte-identical to the tested checkpoint. The four newer main
commits since its `bc1cb678` base changed backend/session authorization and
parity documentation, with **no client file changes**. The eighth checkpoint's
focused viewer suite passed **6/6**, its production client build passed, and
authenticated Chromium checked 24 direct cases at 1440×900, 390×844 and
375×667, plus four gallery cases, short-screen scrolling, and viewer controls
in all eight themes under light/dark appearance. Desktop image long edges were
**14.6–15.8%** smaller. Existing focused tests and paired browser evidence are
recorded in the
[master website QA checklist](../WEBSITE_QA_RELEASE_CHECKLIST_20261123.md).
Unchanged suites were not rerun for this source-identical review candidate. The refreshed
iOS parity document from main is retained.

## Owner-reported QA approvals

- The owner reported that the initial website QA pass was satisfactory, without
  a case-by-case scope. That report is not a blanket PASS for later changes.
- The owner confirmed native Chatforia and SMS/MMS inline image sizing and
  presentation were consistent under the tested conditions.
- The owner visually approved the final shared viewer's desktop dimensions,
  landscape and square images, and portrait image presentation on an iPhone SE.
  The exact device/test setup was not independently recorded. Automated local
  Chromium separately checked 1440×900, 390×844 and 375×667, with the 920px
  modal limit, 14.6–15.8% desktop image reduction, caption/Download visibility,
  gallery Back, original-byte downloads, focus restoration, and eight-theme
  controls. This visual approval does not establish live-carrier delivery or
  every gallery, download, or authorization interaction on a physical device.
- The owner reviewed Velvet accessibility previews and rejected dark text/icon
  rectangles. Its approved pink-to-gold gradient, white text and white
  microphone remain. The roughly 1.4–1.61:1 white-on-gold text contrast is a
  documented WCAG AA exception; approved appearance is not AA compliance.
- The owner acknowledged correction of the disposable upload fixture's local
  500. The authenticated local browser check passed image selection, preview,
  caption and removal without a send. An owner retest after the correction was
  not reported.

## Local authenticated QA environment

The corrected Vite server is listening from the original website checkpoint
worktree on `[::1]:5173`; the disposable backend is listening from that same
worktree on `127.0.0.1:5002`. A local-only image upload fixture is listening
on `127.0.0.1:5004`; it replaced the read-only fixture that caused a local
`POST /uploads/intent` 500. The authenticated local image selection, preview,
caption and removal check passed without an SMS send. On November 25, frontend
HTTP and backend
`/health` each returned 200. A local Socket.IO polling handshake returned
200 with `Access-Control-Allow-Origin: http://localhost:5173`; the disposable
PostgreSQL fixture and account password file remain present under the existing
private `/private/tmp/chatforia-webqa-20261124.QrNEHS` directory. These checks
use disposable accounts and fixtures; they are not live-provider checks.
Use `http://localhost:5173/` and the existing disposable `dev_user_1` and
`dev_user_2` credentials in that private fixture. Do not use production users,
real carrier sends, or real eSIM purchases. The running Vite server serves the
**original checkpoint**, whose client bytes match this review candidate.

## Remaining manual, provider, and device verification

1. **Native conversation switching and recovery.** As `dev_user_1`, open two
   previously loaded direct/group rooms and switch A→B→A rapidly. The prior
   confirmed messages should appear immediately, with background refresh and
   no loading flash. In a second session, edit/delete a message while the
   first browser is offline; reconnect and confirm the edit/deletion replaces
   stale content. Check message order, pagination, unread/read state, drafts,
   attachments and realtime additions. Logout, sign in as `dev_user_2`, and
   confirm no prior account content appears. Exercise a denied/removed room and
   a changed/locked encryption key if the disposable fixture supports them.
2. **Native/MMS images.** The owner-approved inline parity and final viewer
   visuals need no repeat visual signoff. On a device, still verify direct open,
   gallery Back only when gallery-opened, original-byte Download, Escape/focus
   where supported, and conversation scroll restoration. Confirm `dev_user_2`
   cannot fetch `dev_user_1`'s private media after account change or revocation.
   Real carrier/cloud MMS remains a separate provider check.
3. **Composer and Help.** Review native new/existing and SMS new/existing
   conversations at 360, 375, 390, 440, 488, 768, 1032 and 1280px. Confirm
   the text field remains usable, placeholder does not break mid-word, action
   row does not cover Send, and Help is absent on messaging screens but
   reachable through Settings. From People → Message, open `/sms/compose`;
   choose, preview, remove and retry a disposable image with a caption.
   Confirm a failed send keeps the draft. Do not attempt live carrier delivery.
   SMS voice-note sending remains unavailable under the carrier format
   allowlist; native microphone behavior should remain intact.
4. **Themes and accessibility.** Review Dawn, Midnight, AMOLED, Aurora, Neon
   Premium, Sunset, Solarized and Velvet at desktop/mobile widths under light
   and dark system appearances. Check message bubbles, toolbar/icon colors,
   composer, Send/microphone, gallery controls, keyboard focus and Premium
   locks. Preserve approved Neon and Velvet styling. Velvet's white outgoing
   text on the gold gradient is a confirmed roughly 1.4–1.61:1 contrast
   exception; the owner rejected a dark surface. Record an explicit design/
   accessibility disposition before claiming WCAG AA for every theme.
5. **Existing commercial and media release gates.** With disposable accounts,
   verify Wireless Top up opens the Mobile packages and ordinary Pricing opens
   App plans; inspect owned purchased-package/replacement states without
   checkout. Confirm authenticated SMS media authorization, account isolation,
   image reload/cache and viewer download. No actual Telna or carrier purchase
   is needed for this website-code review.

Owner-led physical mobile browser checks may require an approved nonproduction
network route: the current Vite listener is loopback-only. Desktop responsive
emulation and the recorded local Chromium evidence are not physical-device QA.

## Genuine release gates

- **Code review:** review eight source commits, the retained main parity
  document, the excluded account-66 handoff, and this checklist. The candidate
  can be reviewed independently of the protected username workflow, Stage A,
  group-invitation activation, Broadcast Messaging and MLS. No new backend API
  is introduced by these website commits.
- **Manual outcomes:** owner visual approvals are recorded above. Offline
  missed-edit/deletion reconciliation and account/key/membership denial still
  lack an owner-led pass. The known Velvet contrast exception needs an explicit
  launch accessibility disposition if full AA conformance is required; no
  redesign is included here.
- **Frontend deployment controls:** current main's `deploy.yml` deploy job
  still uses `npm install`, runtime `ssh-keyscan` without the pinned comparison
  used by `verify_ssh`, and no exact build/revision check. The previously
  prepared, uncommitted hardening diff remains in
  `/Users/juliannorton/Desktop/chatforia-web-release-slice1-20261123`.
  Review and transfer that existing work as a separate deployment-control
  change before any production web deployment. Do not run the current deploy
  job merely because `verify_ssh` passes.
- **Production compatibility:** the last verified live frontend was
  `a69f5fbc`, API `13feefb6`, and ledger 166 active/five rolled back/zero
  unfinished; the owner-reported runtime-grant preflight passed with exit 0.
  Reuse that evidence. The approved migration-167 source is not proof it is
  deployed. Confirm exact frontend artifact and current API contract at the
  eventual release window, then perform the disposable-account authenticated
  SMS media and eSIM checks. Keep notification session-authority deployment
  and the protected username migration in their separate approval tracks.

This documentation reconciliation did not resume localization, change
production, make a provider purchase, or rerun completed test suites.

## Release recommendation for owner decision

**GO for focused code review and pull-request preparation of this local
website candidate. HOLD production deployment.** The branch carries eight
reviewable website checkpoints with no backend or native changes, and its
client tree matches the locally tested checkpoint. The remaining predeployment
gates are: (1) review and transfer the existing SSH host-key pinning, `npm ci`,
and exact artifact/revision deployment controls; (2) verify the final release
artifact against the running API contract at the release window; (3) complete
disposable-account authenticated SMS media and eSIM navigation/owned-package
checks on the final candidate; and (4) record the offline missed-edit/deletion
and revoked-room/account-key manual outcomes or an explicit release risk
decision. Do not claim all-theme WCAG AA while Velvet's text exception remains.
Live carrier delivery, real purchases, broader physical-device coverage, and
the separate protected-username, notification-authorization, MLS, and Random
Chat workstreams are not silently counted as completed by this website review.

## Focused release-verification addendum — November 25

The authenticated disposable environment completed the remaining local checks
after the review above. Browser offline mode retained confirmed native messages;
an edit and deletion made while offline reconciled after connectivity returned
and `/messages/1` refreshed. Native private-media access returned 404 to an
unrelated account and, after membership revocation, both a new grant and an
already issued file URL returned 404. The MMS owner received 200 and the other
account 404. Temporary messages and membership changes were cleaned up.

The new-SMS composer selected, previewed, removed, and reselected a local image;
the caption and attachment survived an intercepted 503 and a simulated 202
retry used a private upload key. Intent, PUT, and complete returned 200 against
the disposable upload fixture. No carrier send occurred. Ordinary Pricing
opened App plans; Wireless opened Mobile packages. A temporary `mock-` eSIM
purchase drove real local LOW and EXHAUSTED API/browser states, and the
purchase listing correctly showed provider unverified and replacement
ineligible. The mock purchase was removed; no purchase or provider call occurred.
The corresponding scripts and redacted results are the three
`final-release-*-20261125.mjs` and `.json` pairs in this directory. The master
checklist records exact outcomes and remaining limits.

The separate deployment patch was transferred unchanged to clean local branch
`release/web-deploy-hardening-review-20261125` in workflow-only commit
`e346cfe3`, followed by PR/runbook commit `0d5606b2`. It passed
`git diff --check`, YAML parsing, `bash -n` for all seven shell steps, and a
focused static review: it checks the known ed25519 fingerprint, requires an
exact reviewed main SHA, runs locked `npm ci --ignore-scripts`, and compares
built and remote artifact hashes before reload. Its SHA-256 diff digest is
`c2cd5d8ecc1e6e933436b4d6feacceb6e1297fd3d203892af354db05804eebb6`.
It has not been pushed, merged, or CI-validated. Because it preserves and excludes
`env.js`, the release operator must independently verify that runtime file and
the live serving host. No deployment approval is implied.

The local authenticated checks clear the specific offline reconciliation,
private-media authorization, composer, and mock owned-package questions. At
that checkpoint they did not establish physical-device behavior, live carrier/Telna delivery, or
account/encryption-key invalidation in the owner interface. Velvet's approved
appearance and roughly 1.4–1.61:1 text contrast exception remain unchanged and
require an explicit accessibility disposition. The review candidate still
requires the separate deployment-control change and exact post-merge
artifact/API verification before release.

**Physical iPhone Safari composer follow-up:** owner testing found partial Send
clipping after the message field received focus. The shared textarea computed
to 14px before correction. The mobile-only release-review change raises native
and SMS/MMS composer text to at least 16px; the new native recipient field uses
the same minimum. Focused component tests passed 9/9 and the production build
passed. Authenticated Chromium measurements in
`iphone-composer-layout-20261125.json` show 16px fields and Send within the
360px/375px simulated viewports; desktop remains 14px. The temporary HTTPS
gateway served this corrected worktree for owner review. The owner approved
checkpoint `e6b0a155` after physical iPhone Safari testing: Send remained
visible while the keyboard was open, layout returned on dismissal, and manual
pinch zoom worked. Photo selection, local upload, image preview, shared image
viewing, and MMS image download also passed on that iPhone. This is owner-led
device evidence, distinct from the 9/9 automated tests and Chromium geometry
report. Physical Android browser behavior, native image download on device,
live carrier delivery, and Telna purchases remain unverified. The disposable
HTTPS gateway and its temporary CA are removed after this approval; localhost
QA services remain. Velvet and other themes are unchanged.

**PR and environment status after owner approval:** PR #355 merged the separate
deployment-workflow hardening at `039cdddd`; it did not dispatch deployment.
PR #354 remains open for the website candidate and this approved Safari
follow-up. The temporary LAN gateway stopped and its local CA key, server key,
certificate, and profile were deleted. The localhost Vite website and disposable
API remain running. The owner must remove the manually installed QA certificate
profile from the iPhone under Settings > General > VPN & Device Management.
Post-merge artifact/serving-host/API-origin checks and any production rollout
still require separate approval.
