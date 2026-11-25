# Website QA release checklist — updated 2026-11-24

This is the release inventory for the isolated website QA work. Statuses refer to this
inventory, not to a production feature flag. Do not merge the older QA branch as a whole.

## Baselines and status key

- Source QA worktree: `/Users/juliannorton/Desktop/chatforia-web-final-polish-qa-20261121`, branch `qa/web-final-polish-20261121`, HEAD `c4135d07203202a8349b553ee6c117b8fd8ea626`. It retains 193 modified tracked files and 21 untracked files. Its QA changes are uncommitted.
- First release worktree: `/Users/juliannorton/Desktop/chatforia-web-release-slice1-20261123`, branch `release/web-download-wireless-20261123`, based on refreshed `origin/main` at `13feefb66731c5beea08b9836571be7a809142f5`.
- First release pull request: [#348](https://github.com/nortonjulian/chatforia/pull/348), merged as `05a98035`; its fixes are in current main, but the verified live frontend remains `a69f5fbc`, so they are not yet deployed.
- **Completed QA** means implemented in the source QA worktree; **transferred** means selectively present in the release branch; **merged** means a separate PR reached main; **deployed** means included in a recorded successful frontend deploy workflow. These are separate states.
- The verified live frontend is `a69f5fbc08c920c9146bda8a34454b51b5cc5eb8`; the verified running API is `13feefb6`. The owner verified the production migration ledger as 166 active, five rolled back, zero unfinished, zero pending, with exact pinned history. Do not repeat this check. Frontend deployment remains on hold.
- Current main baseline for the new local checkpoint is `bc1cb678` (PR #349). Worktree: `/Users/juliannorton/Desktop/chatforia-web-conversation-mms-checkpoint-20261124`, branch `qa/web-conversation-mms-checkpoint-20261124`. This checkpoint has no merge, push, or deployment authorization.

## First release slice: download and Wireless navigation

| Change | QA | Release worktree | Main / deployment |
| --- | --- | --- | --- |
| Restore `/download` QR for the existing `https://go.chatforia.com/app` destination | Completed QA | Transferred `client/public/qr-chatforia.png` and link/accessibility treatment in `client/src/pages/Downloads.jsx` | Merged in `05a98035`; not live at verified frontend revision |
| Equal-height, vertically aligned store badges | Completed QA | Transferred responsive layout; retained main's existing official `AppStore.svg` and `GooglePlay.svg` artwork and the existing iOS/Android destinations. Their different intrinsic transparent margins require 38px and 57px element heights for visually matched 38–39px artwork. | Merged in `05a98035`; not live at verified frontend revision |
| Wireless Top up / View plans opens Mobile (eSIM), with URL-backed tab and scope state | Completed QA | Transferred focused edits to `WirelessDashboard.jsx` and `UpgradePlan.jsx`; ordinary `/pricing` still defaults to App plans | Merged in `05a98035`; not live at verified frontend revision |

Focused tests: `Downloads.test.jsx`, `WirelessDashboard.test.js`, and `UpgradePlan.test.js` — **24 passed** on this release worktree. Production `npm run -w client build` passed; `git diff --check` passed. Dependencies were installed from the existing lockfile using `npm ci --ignore-scripts --no-audit --no-fund`; no server Prisma generation ran. The build's unrelated regenerated logo-kit ZIP was restored to its original tracked bytes.

Headless Chromium checks at 1280px and 390px: QR and both badges loaded; the QR anchor points to the existing smart link; visible badge artwork measured 38px and 39px high on the same row at both widths; no horizontal overflow on `/download` or Mobile pricing. Scrolling revealed Local data package cards at both widths. An ordinary `/pricing` visit showed App plans; browser back restored `/pricing?section=mobile&scope=europe`. Final download screenshots: `/private/tmp/chatforia-release-download-final-{1280,390}.png`. Pricing card screenshots: `/private/tmp/chatforia-release-pricing-cards-{1280,390}.png`.

**Review gate:** PR #348 was merged. Deployment still requires separate approval. Do not treat the local production build as deployment evidence.

## Next separate release slice: native conversation snapshots

Status: **completed QA, selectively transferred to the 2026-11-24 local checkpoint, not merged or deployed**. The source QA implementation previously passed 19 focused tests and a production web build. The checkpoint ports only cache behavior onto `bc1cb678`; Stage A, group, and invitation edits remain excluded.

Source files to reconcile: `client/src/utils/nativeThreadSessionCache.js`, cache-specific hunks of `client/src/AppRoutes.jsx`, `client/src/pages/ChatThreadRoute.jsx`, and `client/src/components/ChatView.jsx`. Port cache tests from `client/src/utils/__tests__/nativeThreadSessionCache.test.js`, `client/src/pages/__tests__/ChatThreadRoute.cache.test.jsx`, and cache-specific cases in `client/__tests__/ChatView.test.js`.

Safety gates: memory only; at most 12 rooms and 50 confirmed messages per room; 60-second room/message validation age; account and encryption-key scope; clear on logout, key changes/lock, room membership changes, 401/403/404 and failed refresh; reject late responses; reconcile edits, deletions, ciphertext identity, attachments and realtime messages; keep SMS isolated. The checkpoint's cache, route, and ChatView focused suites pass; the production web build passes. Authenticated browser switching and offline recovery remain manual release checks.

## Other QA work and dependencies

### 2026-11-24 local checkpoint evidence

On `bc1cb678`, locked dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund`. Focused Jest runs passed: native cache/route/authenticated SMS media **23/23**, ChatView including snapshot reconciliation, online retry, realtime arrival, deletion during refresh, and 401/403/404 access loss **20/20**, and eight-theme tokens, message bubbles, selection and gating **38/38**. Total: **81/81** focused tests across eight suites. `npm run build -w client` and `git diff --check HEAD` passed. The build-generated logo ZIP was restored; it is not part of the checkpoint.

Implementation is complete locally for native snapshot switching, MMS image-only presentation/keyboard access, and previously verified eight-theme semantic tokens. Automated verification is complete for the listed suites. Authenticated desktop/mobile browser verification, system light/dark appearance, rendered contrast, offline expiry/recovery, and production smoke checks remain pending. No physical browser or device verification is claimed here.

Current main's socket reconnect delta path appends newer message IDs. It does not independently reconcile edits or deletions missed while a room stays open offline. Reopening a room performs the authoritative refresh in this checkpoint. Treat an in-place reconnect edit/deletion check as pending before release; do not claim complete offline synchronization from the focused tests alone.

Localization remains paused. The existing eSIM translation handoff, proposals, and validation evidence in the website release worktree are preserved without modification. Stage A/MLS, group invitation activation, Broadcast Messaging, Random Chat, and notification authorization remain separate. The production migration history is already verified; runtime-role grant preflight plus authenticated eSIM and SMS media checks remain release gates. Deployment SSH fingerprint and commit-pinned artifact controls require release-operator review before any deployment.

| Work item | Current status | Release decision / remaining check |
| --- | --- | --- |
| SMS/Chatforia bubble spacing, PR [#268](https://github.com/nortonjulian/chatforia/pull/268) | Merged into main and included in the last recorded frontend deploy | Do not repeat. |
| Secure group invitation routing, PR [#225](https://github.com/nortonjulian/chatforia/pull/225) | Merged into main; frontend commit included in the last recorded deploy | Do not port the older QA invitation gate or router assumptions wholesale. Verify backend deployment, authorization, E2EE membership/key distribution, and native behavior separately. |
| SMS/MMS image-only presentation | Transferred to local checkpoint; not merged or deployed | Uses current main's authenticated `SmsMessageMedia` Blob fetch and account-scoped SMS loader. Image-only MMS loses the opaque bubble; gallery image is a keyboard-operable button. Desktop/mobile authenticated browser check remains. |
| AI & Ria Bot naming and localization | Completed QA in 148 locale files; not transferred | Review translated wording, then port without Stage A copy keys or unrelated settings changes. |
| Eight-theme iOS parity and shared accessibility corrections | Transferred to local checkpoint; not merged or deployed | Token and focused component tests pass for all eight themes. Preserve approved Electric Cobalt × Ultraviolet Neon and Velvet pink-to-gold/white treatment. Velvet outgoing white text remains about 1.4:1 at the gold end; user rejected dark rectangles. Browser contrast and responsive checks remain before release; obtain an approved remedy or document the exception before claiming accessibility completion. |
| Group creation/member management and invitation preparation | Completed or prepared in QA; not transferred | Coordinate with current main and backend E2EE membership handling. Current main has newer invitation and group code. No invitation activation from this checklist. |
| Stage A encrypted-message enforcement | Completed in QA; not transferred | Hold for the independent MLS integration worktrees and coordinated backend contract. Do not ship it in a website-only slice. |
| Broadcast Messaging | No independently verified transferable QA slice | Keep separate from this website release. |
| eSIM checkout and purchase lifecycle | Not changed by this slice | Navigation and plan visibility passed; end-to-end checkout/provider verification remains separate. |
| Full responsive/accessibility sweep | Partial focused checks | Recheck each later release slice at desktop/mobile widths and with keyboard access. |

No complete pre-existing website QA checklist file was found in the source worktree. This document is the master inventory for the known completed and outstanding items; update it as slices are reviewed, merged, and deployed.
