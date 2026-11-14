# eSIM visibility regression audit — 2026-11-14

This review branch starts at web/backend `aa4b4e040464336033ed8f9679290e727d58e7a6`. It carries forward the isolated eSIM lifecycle and read-only purchase ledger work from `launch/esim-international-connectivity-20261113`, then adds the missing web ledger display. It has not been merged or deployed. The mobile builds have not been replaced.

## Live account reconciliation (read-only)

For account 1, the active Subscriber record ends in ICCID **0813**. Purchases **42** and **43** both reference that ICCID and have recorded Stripe payment-intent references, Telna package IDs, no recorded refund, and no provisioning-error flag. No eSIM replacement record exists for the account. At the time of the audit, purchase 42 recorded 2,084 MB remaining and purchase 43 recorded 3,072 MB remaining. Their recorded expiries were November 13 at 03:33:20 and 19:27:49 UTC respectively. Read-only Telna `GET /v2.1/pcr/packages/{id}` returned `TERMINATED` for both, with matching expiry times and remaining balances of approximately 2,014 MB and 3,072 MB. This establishes the recorded payment and provider package lifecycle; the Stripe charge itself was not independently retrieved.

The deployed `GET /api/wireless/status` filters candidates to unexpired packages with a positive balance, so it will not classify either purchase as queued on November 14. We did **not** call that endpoint during the live audit because it can refresh stored usage. The read-only SQL used `BEGIN TRANSACTION READ ONLY` and selected only the affected account; no purchases, eSIMs, or settings were changed.

## Version and source comparison

| Surface | Last known working feature source | Current/deployed or installed evidence | Finding |
| --- | --- | --- | --- |
| Backend | Web/backend PR #145 (`9ed3cf64`) added provider-aware active/queued status and replacement route. | `origin/main` and API runtime are `aa4b4e04`; web bundle remains from `a69f5fbc`. | The routes remain. Expired/Telna-terminated packages are excluded from queued status. |
| Web | PR #145 recorded Telna queued behavior, but did not add queued/transfer UI to `WirelessDashboard` or `EsimActivatePage`. | `a69f5fbc` bundle and `aa4b4e04` source have no queued display or replacement action. | Queued visibility on web was an omission, with no documented owner approval to omit it. This branch displays queued packs and a read-only purchase history, including expired or terminated purchases. Web transfer remains a separate product/UI decision; the read-only eligibility reason is displayed. |
| iOS | PR #31 (`e3a8f7e`) added queued data and replacement controls; PR #145 reports live iOS queued display. | `origin/main` `9863a40e` retains both. Paired Regina iPhone has 1.0.2 (37); prepared 1.0.2 (38) has not been distributed. Julian's paired phone was unavailable. | Current source hides replacement for expired status and shows queued only when the API supplies a positive queued balance. Build 37's metadata does not identify its source revision because that build number was reused. |
| Android | PR #50 (`e4e23d6`) added queued and replacement controls; PR #82 retained native management. | `origin/main` `cc3641be` retains both. Connected emulator has versionCode 50; its pulled APK contains both feature strings and `queuedPacks`. Prepared versionCode 51 has not been distributed. | The installed emulator contains the controls, but the current account's expired API status hides them. |

## Other material removals reviewed

| Change | Reason documented in PR | Owner authorization in PR record |
| --- | --- | --- |
| Active provisioning QR/manual credentials hidden: web #146, iOS #32, Android #51 | Avoid exposing active eSIM provisioning secrets; preserve pending setup. | No explicit owner approval located in those PR descriptions. |
| Notify on Copy switch removed: web #243, iOS #52, Android #78 | Switch did not represent a working copy-notification feature; ordinary Copy remains. | No explicit owner approval located in those PR descriptions. |
| iOS incoming-call flash setting removed: #41 | CallKit owns incoming-call UI and app-level flash cannot be reliably delivered. | No explicit owner approval located in the PR description. |
| iOS voicemail availability switch replaced by email-forwarding preference: #20 | Separate voicemail availability from paid email forwarding. | No explicit owner approval located in the PR description. |
| Web empty SMS threads hidden: #169 | Hide only after the last message is deleted; retain thread record for reappearance. | No explicit owner approval located in the PR description. |
| Web Stories upload route removed: #252 | Route was unimplemented and failed after upload; Prisma Story model absent. | PR description explicitly records user confirmation that the old Stories/Status plan was abandoned. |

Other searched deletion/hiding commits concern redundant labels, deleted-message display, obsolete scripts, and unused API fields. No removal of queued-package or replacement code appears in the intervening native source history. This source audit cannot prove the absence of every runtime or device-specific regression; the unavailable Julian iPhone and undistributed mobile builds remain evidence limits.

## Current branch checks

- Six focused backend suites passed against a newly created disposable local PostgreSQL 18 database populated with `prisma db push`; no migration was executed or replayed. Provider calls in these tests were mocked.
- Focused web tests passed **17/17** and the Vite production build passed on the reconciled branch.
- `git diff --check` passed. Prior authenticated browser QA receipts and the original eSIM review-branch test evidence were left untouched.

The new purchase endpoint performs Telna GET lookups and does not update the ledger. The web view labels recorded balances as recorded and shows expired/terminated packages separately from currently usable queued data. Replacement remains blocked for this account because no active, unexpired package is eligible; this branch does not initiate replacement.

The previously prepared account-level operation lock is preserved on `launch/esim-international-connectivity-20261113` and excluded here because its new migration changes the pinned release set. The static sibling-package guard in this branch is not an atomic cross-workflow guarantee if a paid purchase is created concurrently with replacement. Do not perform a live replacement until that race and Telna's multi-package transfer semantics are resolved.
