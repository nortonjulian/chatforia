# Website final QA — local pull-request draft

Prepared November 25, 2026. PR #354 is open; the earlier source/base details below are historical review evidence, not deployment authorization.

## Proposed PR

**Title:** Finish website conversation, media, composer, and eight-theme QA

- **Base:** `origin/main` `d189cf65b213c307f4fc4b3a84709f97c08e13a9`
- **Reviewed source head:** `482348785c48065342cc6d1693c10925733a426a`
- **Branch:** `release/web-final-qa-review-20261125`

### Description for the PR

This release candidate replays the eight preserved website QA checkpoints on current main. It makes previously loaded native Chatforia rooms reopen from bounded, session-only snapshots, then refreshes authoritative history on room access, socket reconnection, and browser connectivity recovery. Snapshots remain scoped to the authenticated account, encryption key, and room; access denial, membership/key changes, logout, and expiry remove stale content. SMS state stays separate.

Native Chatforia and SMS/MMS images now share 220px inline sizing, natural proportions, caption placement, and a responsive in-app image viewer. Direct image clicks open the selected image; explicit gallery access remains available. Viewer downloads fetch fresh authorized original bytes, and native private-media grants and authenticated SMS media retrieval stay intact. The new-SMS composer supports image preview/removal and the existing private-reference MMS send path. Responsive composer controls and Help placement are corrected. Approved semantic styling for all eight themes is retained, including Build 50 Neon. The owner-approved Velvet refinement preserves its exact pink-to-gold outgoing gradient and white microphone/CTA labels with deep-plum `#241031` outgoing message text.

The original eight-checkpoint replay changed **40 client paths** (26 source, 12 focused-test, two QA-script paths) and **152 QA documentation/evidence paths**, including the master checklist. The later Safari checkpoint `e6b0a155` adds the new-conversation recipient field as one client path and updates the shared composer CSS. It changes no backend, schema, native, MLS, Random Chat, Wireless, localization, protected-username, or deployment-workflow files. Existing PR #348 download/Wireless changes are in the base and are not repeated. The original replay's `client/` tree matched tested checkpoint `8f812f7c8ceacd735fba1d3841e075fe83a72170`; the approved Safari correction follows it.

### Verification already completed

- Original native snapshot change: 19 focused tests and production client build. Later integrated focused run: 84/84 across eight suites, production build, and 32/32 eight-theme desktop/mobile light/dark browser cases.
- Inline native/MMS image parity: 35/35 focused tests, production build, and paired portrait/landscape/square fixtures at 1280px and 390px.
- Shared viewer: 55/55 focused tests, production build, authenticated local media authorization and original-byte download checks. Final refinement: 6/6 focused tests, production build, 24 paired direct-view cases at 1440×900, 390×844, and 375×667, four gallery cases, and 16 theme/appearance control checks.
- Responsive composer/Help: 18/18 focused tests, production build, and 32/32 authenticated local route/viewport cases across 360–1280px.
- New SMS/MMS composer: 21/21 focused tests, production build, authenticated local image selection/preview/removal/caption checks, and intercepted send/failure cases without carrier delivery. The disposable upload fixture's local 500 was corrected; intent, upload, and complete then returned 200.
- Final focused disposable Chromium checks: missed edit and deletion reconciled after offline mode and authoritative refresh; native media grant and previously issued file URL returned 404 after room-membership revocation; native and MMS cross-account media requests returned 404. Temporary messages and membership changes were cleaned up. The new-SMS composer passed real local upload/preview/removal and intercepted 503/202 send recovery. Real no-package eSIM navigation passed; a temporary mock local purchase exercised LOW, EXHAUSTED, owned-package listing, and ineligible replacement state without payment or Telna. Evidence: [master checklist](../WEBSITE_QA_RELEASE_CHECKLIST_20261123.md) and the three `final-release-*-20261125.json` reports beside this draft.
- Velvet contrast follow-up `8b52ed50`: owner-approved appearance; authenticated disposable Chromium measured **4.946:1** minimum outgoing message and edited-label contrast across the rendered gradient at 1280px/390px under light/dark appearances. The white caption measured 16.339:1. Focused theme/native-message/SMS suites passed 33/33, the final theme assertion passed 14/14, and the production build passed. The seven other themes' tokens were unchanged. Paired captures and reports are in `velvet-text-refinement-20261125/`.
- `git diff --check origin/main..HEAD` passed. Unchanged earlier suites were not rerun solely for this release review.

The owner reported satisfactory initial website QA, confirmed native/MMS inline image parity, and visually approved the final viewer desktop sizing, landscape/square display, and iPhone SE portrait display. The owner later approved Safari composer checkpoint `e6b0a155` on physical iPhone hardware: Send stayed visible when the keyboard opened, layout recovered when it closed, and pinch zoom worked. Photo selection, local upload, image preview, shared image viewing, and MMS image download also passed on that iPhone. These are owner-led physical-device results; automated results remain listed above. They do not establish physical Android browser behavior, native image download on device, or live carrier delivery. Details are in the [master checklist](../WEBSITE_QA_RELEASE_CHECKLIST_20261123.md) and [release review handoff](WEBSITE_FINAL_QA_RELEASE_REVIEW_20261125.md).

### API and release compatibility

The previously verified production API revision is `13feefb6`; the ledger has 166 active migrations, five historical rollbacks, zero unfinished and zero pending, with exact pinned history. The owner reported the existing runtime-grant preflight passed with exit 0. Reuse these results without requerying production.

Source review of that API revision found the existing contracts required by this candidate: authenticated `GET /chatrooms/:id` and `GET /messages/:roomId` with cursor pagination; `GET /private-media/message/:attachmentId?variant=file` and its short-lived authorized file URL; authenticated, owner-scoped `GET /sms/media/:messageId/:index`; `GET /sms/threads/lookup`; `POST /uploads/intent` and `/uploads/complete`; and `POST /sms/send` with private upload keys in `mediaUrls`. The last endpoint still depends on configured carrier infrastructure for real delivery. The candidate adds no API or migration requirement. Source compatibility is not a substitute for final authenticated runtime checks.

The exact deployable frontend artifact must be built from the **reviewed post-merge main SHA**, with locked dependencies, and its file hash verified against the installed files before activation. The separate deployment patch, prepared in commits `e346cfe3` and `0d5606b2`, merged through PR #355 at `039cdddd`. It pins the SSH host key, uses `npm ci --ignore-scripts`, verifies the dispatched commit, and compares local/remote artifact hashes. It is **not part of this website PR**, and no production deployment has been dispatched. Because the patch excludes and preserves `env.js`, verify the installed runtime API/Socket origin points to the approved production API before release. A final build or hash cannot be asserted until the exact post-merge SHA exists.

### Known limitation and independent work

The owner rejected the earlier Velvet dark-surface preview, then visually approved deep-plum outgoing text on the unchanged gradient at checkpoint `8b52ed50`. Rendered minimum text contrast is **4.946:1**. This targeted correction does **not** establish full WCAG AA conformance across every component or physical device.

Live carrier delivery, Telna purchases, physical Android browser behavior, native image download on device, and broader physical-device interactions remain unverified. Offline missed edit/deletion and room-membership media revocation passed local disposable-browser/API checks, but owner-led device signoff for those scenarios has not been reported. Same-browser logout/account switching passed owner QA; focused account/key invalidation passed disposable browser tests, but physical key replacement/locked-key behavior and immediate remote key-rotation detection in an already-open tab remain unverified. SMS audio sending is unsupported by the current carrier format allowlist; this PR does not add a false microphone send path. Localization is paused. Protected username, notification authorization, MLS, group-invitation activation, Random Chat, and Broadcast Messaging retain separate release tracks.

## Approval checklist

- [x] Confirm base and source scope: `origin/main` at `d189cf65`, with no main divergence or unrelated implementation paths. Subsequent commits add review documentation and local verification evidence only.
- [x] Preserve all eight original website checkpoints and owner-approved viewer/inline visual outcomes.
- [x] Reuse completed automated tests, build evidence, and `git diff --check`; do not rerun unchanged suites solely for review.
- [x] Focused local A→B→A evidence retained; offline missed edit/deletion, reconnect refresh, room-membership media revocation, and native/MMS account isolation passed with disposable accounts.
- [x] Local new-SMS image selection, preview/removal/caption, failed-send draft retention, and intercepted retry passed; no carrier send.
- [x] Ordinary Pricing App default and Wireless Mobile navigation passed; a temporary mock local purchase exercised owned LOW/EXHAUSTED and ineligible replacement states without payment or provider contact.
- [x] Keep deployment hardening separate: PR #355 merged at `039cdddd`; no production deployment was dispatched.
- [x] Record owner-led physical iPhone Safari approval for the corrected composer, photo selection/upload/preview, shared image viewing, and MMS download. Focused follow-up tests passed 9/9 and the web build passed at checkpoint `e6b0a155`.
- [ ] Decide whether remaining physical Android browser, key replacement/locked-key, native image download, and live carrier/provider checks gate release; do not infer PASS from the iPhone subset.
- [ ] Verify the exact post-merge SHA, artifact hash, live host, and approved runtime `env.js` API/Socket origin before deployment approval.
- [x] Owner visually approved Velvet's deep-plum outgoing text on its unchanged gradient; local rendered minimum is 4.946:1. Do not infer full WCAG compliance.
- [ ] Obtain separate owner approval for merge and deployment. Neither is authorized by this PR draft.

**Recommendation:** PR #354 includes the owner-approved Safari and Velvet checkpoints and is ready for merge consideration after required non-deployment CI passes. Physical Android, live carrier/Telna, physical key replacement, and broader accessibility verification remain explicit release considerations. Hold deployment until separate approval and exact post-merge artifact/API checks. Do not infer broader device or provider coverage from the iPhone subset.
