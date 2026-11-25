# Website final QA — local pull-request draft

Prepared November 25, 2026. This is a local review artifact, not a published PR or deployment authorization.

## Proposed PR

**Title:** Finish website conversation, media, composer, and eight-theme QA

- **Base:** `origin/main` `d189cf65b213c307f4fc4b3a84709f97c08e13a9`
- **Reviewed source head:** `482348785c48065342cc6d1693c10925733a426a`
- **Branch:** `release/web-final-qa-review-20261125`

### Description for the PR

This release candidate replays the eight preserved website QA checkpoints on current main. It makes previously loaded native Chatforia rooms reopen from bounded, session-only snapshots, then refreshes authoritative history on room access, socket reconnection, and browser connectivity recovery. Snapshots remain scoped to the authenticated account, encryption key, and room; access denial, membership/key changes, logout, and expiry remove stale content. SMS state stays separate.

Native Chatforia and SMS/MMS images now share 220px inline sizing, natural proportions, caption placement, and a responsive in-app image viewer. Direct image clicks open the selected image; explicit gallery access remains available. Viewer downloads fetch fresh authorized original bytes, and native private-media grants and authenticated SMS media retrieval stay intact. The new-SMS composer supports image preview/removal and the existing private-reference MMS send path. Responsive composer controls and Help placement are corrected. Approved semantic styling for all eight themes is retained, including Build 50 Neon and Velvet's pink-to-gold outgoing gradient with white text and microphone.

The candidate changes **40 client paths** (26 source, 12 focused-test, two QA-script paths) and **152 QA documentation/evidence paths**, including the master checklist. It changes no backend, schema, native, MLS, Random Chat, Wireless, localization, protected-username, or deployment-workflow files. Existing PR #348 download/Wireless changes are in the base and are not repeated. The candidate's `client/` tree is byte-identical to original tested checkpoint `8f812f7c8ceacd735fba1d3841e075fe83a72170`.

### Verification already completed

- Original native snapshot change: 19 focused tests and production client build. Later integrated focused run: 84/84 across eight suites, production build, and 32/32 eight-theme desktop/mobile light/dark browser cases.
- Inline native/MMS image parity: 35/35 focused tests, production build, and paired portrait/landscape/square fixtures at 1280px and 390px.
- Shared viewer: 55/55 focused tests, production build, authenticated local media authorization and original-byte download checks. Final refinement: 6/6 focused tests, production build, 24 paired direct-view cases at 1440×900, 390×844, and 375×667, four gallery cases, and 16 theme/appearance control checks.
- Responsive composer/Help: 18/18 focused tests, production build, and 32/32 authenticated local route/viewport cases across 360–1280px.
- New SMS/MMS composer: 21/21 focused tests, production build, authenticated local image selection/preview/removal/caption checks, and intercepted send/failure cases without carrier delivery. The disposable upload fixture's local 500 was corrected; intent, upload, and complete then returned 200.
- `git diff --check origin/main...HEAD` passed. No test was rerun for this source-identical release review candidate.

The owner reported satisfactory initial website QA, confirmed native/MMS inline image parity, and visually approved the final viewer desktop sizing, landscape/square display, and iPhone SE portrait display. The owner acknowledged the disposable upload fixture correction. These reports do not establish a live carrier send or a later owner retest of the upload flow. Details and screenshot/report paths are in the [master checklist](../WEBSITE_QA_RELEASE_CHECKLIST_20261123.md) and [release review handoff](WEBSITE_FINAL_QA_RELEASE_REVIEW_20261125.md).

### API and release compatibility

The previously verified production API revision is `13feefb6`; the ledger has 166 active migrations, five historical rollbacks, zero unfinished and zero pending, with exact pinned history. The owner reported the existing runtime-grant preflight passed with exit 0. Reuse these results without requerying production.

Source review of that API revision found the existing contracts required by this candidate: authenticated `GET /chatrooms/:id` and `GET /messages/:roomId` with cursor pagination; `GET /private-media/message/:attachmentId?variant=file` and its short-lived authorized file URL; authenticated, owner-scoped `GET /sms/media/:messageId/:index`; `GET /sms/threads/lookup`; `POST /uploads/intent` and `/uploads/complete`; and `POST /sms/send` with private upload keys in `mediaUrls`. The last endpoint still depends on configured carrier infrastructure for real delivery. The candidate adds no API or migration requirement. Source compatibility is not a substitute for final authenticated runtime checks.

The exact deployable frontend artifact must be built from the **reviewed post-merge main SHA**, with locked dependencies, and its file hash verified against the installed files before activation. The existing prepared workflow patch separately pins the SSH host key, uses `npm ci --ignore-scripts`, verifies the dispatched commit, and compares local/remote artifact hashes. It remains uncommitted in the earlier release-slice worktree and is **not part of this PR**. Review and transfer only `.github/workflows/deploy.yml` as a separate deployment-control change; do not bring along that worktree's unfinished locale changes. Because the patch excludes and preserves `env.js`, verify the installed runtime API/Socket origin points to the approved production API before release. A final build or hash cannot be asserted until the exact post-merge SHA exists.

### Known limitation and independent work

Velvet's approved white outgoing text measures roughly **1.4–1.61:1** near the gold end of its approved gradient, below the 4.5:1 WCAG AA normal-text target. The owner rejected the dark-surface preview. This PR preserves the approved appearance and does **not** claim full eight-theme AA conformance. An explicit accessibility disposition is needed if AA conformance is a release requirement.

Live carrier delivery, a physical-device interaction matrix, offline missed edit/deletion recovery, and revoked-room/account-key behavior remain unverified by owner-led authenticated QA. SMS audio sending is unsupported by the current carrier format allowlist; this PR does not add a false microphone send path. Localization is paused. Protected username, notification authorization, MLS, group-invitation activation, Random Chat, and Broadcast Messaging retain separate release tracks.

## Approval checklist

- [x] Confirm base and source scope: `origin/main` at `d189cf65`, candidate 11 commits ahead with no main divergence; no unrelated implementation paths.
- [x] Preserve all eight original website checkpoints and owner-approved viewer/inline visual outcomes.
- [x] Reuse completed automated tests, build evidence, and `git diff --check`; do not rerun unchanged suites solely for review.
- [ ] On the final candidate with disposable accounts, verify A→B→A switching, offline missed edit/deletion reconciliation, reconnect, and account/key/membership denial without stale content.
- [ ] With disposable accounts, verify SMS media account isolation and reload; owner-retest new-SMS image preview/removal/caption and failed-send draft retention without carrier delivery.
- [ ] Verify Wireless Top up opens Mobile packages, ordinary Pricing opens App plans, and owned-package/replacement states without purchase, using the approved nonproduction API.
- [ ] Review and land the separate deployment workflow hardening; verify the exact post-merge SHA, artifact hash, pinned host key, and approved runtime `env.js` API/Socket origin before deployment approval.
- [ ] Record an explicit disposition for Velvet's known contrast exception if full WCAG AA is a release gate.
- [ ] Obtain separate owner approval for merge and deployment. Neither is authorized by this PR draft.

**Recommendation:** Ready for a focused website pull-request review. Hold merge approval until the minimum authenticated checks and Velvet disposition are recorded; hold deployment until the independent workflow controls and exact artifact/API checks are complete. Do not infer live-provider or physical-device coverage from the recorded browser tests.
