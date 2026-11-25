# Website final QA — local release review, November 25

## Review candidate

- Worktree: `/Users/juliannorton/Desktop/chatforia-web-final-qa-release-review-20261125`
- Branch: `release/web-final-qa-review-20261125`
- Base: refreshed `origin/main` at `d189cf65`
- Status: local review only; not pushed, merged, or deployed.

The seven original website checkpoints remain untouched in
`/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124`
at `f2d5d539`. The candidate replays their website corrections as follows:

| Original checkpoint | Review commit | Scope |
| --- | --- | --- |
| `8a88d17b` | `401b6190` | Memory-only native conversation snapshots and accessible MMS images |
| `4ae450b5` | `99951d61` | Eight approved theme tokens and parity evidence |
| `64b43bcc` | `50da1248` | Socket/online authoritative refresh and rendered-theme evidence |
| `d0aea91f` | `9c776b55` | Native/MMS inline image parity |
| `8bab90e5` | `6c6eab7c` | Shared authenticated image viewer and gallery/download behavior |
| `aa666e3d` | `f21dba04` | Responsive composer and Help placement |
| `f2d5d539` | `7289ea45` | New SMS/MMS composition; obsolete account-66 handoff excluded |

The candidate changes no backend, migration, MLS, native, or deployment-workflow
files. `git diff --quiet f2d5d539 HEAD -- client` exited 0: the candidate's
client tree is byte-identical to the tested checkpoint. The four newer main
commits since its `bc1cb678` base changed backend/session authorization and
parity documentation, with **no client file changes**. Existing focused tests,
production client builds, and paired browser evidence are recorded in the
[master website QA checklist](../WEBSITE_QA_RELEASE_CHECKLIST_20261123.md).
They were not rerun for this source-identical review candidate. The refreshed
iOS parity document from main is retained.

## Local authenticated QA environment

The corrected Vite server is listening from the original website checkpoint
worktree on `[::1]:5173`; the disposable backend is listening from that same
worktree on `127.0.0.1:5002`. On November 25, frontend HTTP and backend
`/health` each returned 200. A local Socket.IO polling handshake returned
200 with `Access-Control-Allow-Origin: http://localhost:5173`; the disposable
PostgreSQL fixture and account password file remain present under the existing
private `/private/tmp/chatforia-webqa-20261124.QrNEHS` directory. These checks
establish service availability, not a fresh authenticated account pass.
Use `http://localhost:5173/` and the existing disposable `dev_user_1` and
`dev_user_2` credentials in that private fixture. Do not use production users,
real carrier sends, or real eSIM purchases. The running Vite server serves the
**original checkpoint**, whose client bytes match this review candidate.

## Outstanding owner-led manual verification only

1. **Native conversation switching and recovery.** As `dev_user_1`, open two
   previously loaded direct/group rooms and switch A→B→A rapidly. The prior
   confirmed messages should appear immediately, with background refresh and
   no loading flash. In a second session, edit/delete a message while the
   first browser is offline; reconnect and confirm the edit/deletion replaces
   stale content. Check message order, pagination, unread/read state, drafts,
   attachments and realtime additions. Logout, sign in as `dev_user_2`, and
   confirm no prior account content appears. Exercise a denied/removed room and
   a changed/locked encryption key if the disposable fixture supports them.
2. **Native/MMS images.** With the paired portrait, landscape and square
   fixtures, inspect image-only and captioned messages at desktop and about
   390px mobile width. Both channels should retain 220px inline width, natural
   proportions, transparent image-only MMS surface, caption-below placement
   and 12px corners. Click a specific image: it should open directly in the
   same responsive viewer. Check Close, gallery Back only when gallery-opened,
   Download of original bytes, Escape, focus restoration and conversation
   scroll position. Confirm `dev_user_2` cannot fetch `dev_user_1`'s private
   media. Real carrier/cloud MMS and physical-device behavior remain separate
   provider/device checks; the local fixture does not prove them.
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

- **Code review:** review seven source commits, the retained main parity
  document, the excluded account-66 handoff, and this checklist. The candidate
  can be reviewed independently of the protected username workflow, Stage A,
  group-invitation activation, Broadcast Messaging and MLS. No new backend API
  is introduced by these website commits.
- **Manual outcomes:** record the owner-led cases above. The known Velvet
  contrast exception needs explicit acceptance or a separately approved
  treatment; no redesign is included here.
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

No localization work, production change, provider purchase, or new automated
test suite was started for this review preparation.
