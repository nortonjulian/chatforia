# eSIM purchase/replacement concurrency — separate review branch

This branch is stacked on draft PR #337. It adds a per-account durable `EsimOperationLock` and proposed migration 166 package. It is **not** part of the combined #337/#334 release candidate. The live transfer safety hold from #337 remains in place; neither this branch nor the migration is authorized for production execution.

## Shared claim and paid entitlement handling

- The paid Stripe webhook, initial device replacement, retry, and reconciliation acquire the same account-level database claim before selecting or changing eSIM ownership. A concurrent claimant exits before a Telna POST or old-line action. A webhook conflict returns a retryable failure so Stripe can redeliver the paid event.
- A successfully acquired paid webhook records the purchase before choosing an eSIM. If an earlier replacement remains unresolved, the purchase stays visible with its payment reference but no ICCID or provider package, and the webhook returns a retryable failure. It must not attach to the old or new eSIM until reconciliation resolves the account.
- A definite failed replacement that never created a provider package does not block a later purchase; a failed row with a known new provider package does. Replayed webhook events reuse the existing purchase/provider package instead of buying another package.
- An ambiguous purchase-provider result retains the operation claim indefinitely for operator reconciliation. The claim must never be deleted merely because it is old. A worker crash also leaves a claim; the operator needs evidence of the provider outcome before releasing it.
- If Stripe retries expire, an operator must inspect the payment and event record, then safely redeliver the verified event after reconciliation. The app must never infer nonpayment from a missing local purchase row.

## Transfer remains disabled

The #337 endpoint returns `ESIM_TRANSFER_SAFETY_HOLD` in live environments before any provider operation. The operation claim closes the local race but does not establish Telna's behavior for multiple packages on one ICCID. Do not lift the hold until Telna documents a way to preserve each active or awaiting package's original balance, expiry, and activation state on a replacement eSIM. If no such provider operation exists, keep multi-package replacement unavailable and provide a clear reason.

## Release gate and validation

Migration `20261113010000_add_esim_operation_lock` is the proposed 166th application migration after the already approved 165th. `applicationMigrationRelease.v5.json` pins its exact bytes and remains a **proposal**, not production approval. A future release must verify the production ledger read-only, obtain separate approval for this exact package, take a protected backup, and execute it once through the approved gate before deploying code that reads `EsimOperationLock`. Do not replay earlier migrations.

Focused billing webhook, replacement service and PostgreSQL integration suites: **75/75 passed** against a disposable local PostgreSQL 18 database populated with `prisma db push` (no migration execution). Migration package and MFA recovery checks: **16/16 passed**. Provider actions in tests were mocked; no live eSIM or payment was changed. Existing authenticated browser QA receipts remain untouched.
