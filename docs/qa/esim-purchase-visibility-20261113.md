# eSIM purchase visibility and iOS Manage follow-up

This change follows [the six-item launch-readiness review](./esim-international-connectivity-20261113.md) on the existing `launch/esim-international-connectivity-20261113` review branches. It has not been deployed or installed on the reported iPhone.

## What the reported screens establish

- Xcode reported Chatforia **1.0.2 (37)** on Julian's paired iPhone. The only local archive with that version/build is dated September 22. The version number was not increased when the October 14 replacement UI was committed, so metadata alone cannot prove which source revision is installed.
- The eSIM details screen reads the authenticated user's latest `Subscriber` through `GET /esim/me`. `ACTIVE` describes the eSIM profile. Its old subtitle incorrectly described the data package as active without consulting any package record.
- The old Wireless status response had one `source`. It listed `queuedPacks` only if Telna confirmed another package `ACTIVE`. A paid purchase waiting for provisioning, a `NOT_ACTIVE` purchase without a confirmed active sibling, and historical expired or terminated purchases had no complete ledger in iOS.
- The existing iOS replacement button lived on Wireless, outside the Manage details screen, and was hidden whenever the one displayed status was expired. The review-branch backend already has `POST /api/wireless/esim/:purchaseId/replace` and blocks transfer when other eligible packages or unassigned paid purchases may be affected.
- **The reported additional payment's actual fulfillment and Telna status remain unverified.** The local development database has no user 1 or associated purchases. The local Stripe credential is test mode. The local Telna base URL returned HTML rather than package JSON. None of these can establish the live account's paid-package state.

## Review-branch behavior

- Authenticated `GET /api/wireless/purchases` returns all recorded eSIM purchases for the account, independently classified as `ACTIVE`, `AWAITING_ACTIVATION`, `AWAITING_PROVISIONING`, `PROVISIONING_NEEDS_REVIEW`, `PAYMENT_UNVERIFIED`, `EXPIRED`, `EXPIRY_NEEDS_REVIEW`, `BALANCE_NEEDS_REVIEW`, `EXHAUSTED`, `TERMINATED`, or `PROVIDER_UNVERIFIED`. It performs Telna **GET** lookups for recorded package IDs but does not update the ledger. The response omits full ICCIDs, payment references, and provider package IDs.
- The old Current Usage response now avoids calling a confirmed Telna `NOT_ACTIVE` package active, or a paid unprovisioned purchase active. Its existing consumption refresh remains separate from the read-only purchase list.
- Wireless and the iOS eSIM Manage screen show Purchased Data Packages. Each row shows its individual status, recorded allowance and remaining balance, activation timing when known, and expiry. Ambiguous Telna versus ledger balances or expiries are labeled for review. The eSIM subtitle now describes profile status only.
- Transfer remains the existing replacement workflow. Manage now shows the action or the reason it is unavailable. The backend's actual replacement endpoint still rechecks eligibility; the new read-only gate is deliberately conservative for multiple packages, pending assignment, Unlimited, missing Telna confirmation, and expired balances.

## Minimal live reconciliation, read-only

Use a separately authorized **read-only production database connection**. Verify the connection target before issuing SQL. Do not migrate or update any row. Run the following in a read-only transaction and keep package IDs within the operator's secure session:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT id, username FROM "User" WHERE id = 1;

SELECT id, "purchaseId", right(iccid, 4) AS iccid_suffix,
       status, "createdAt", "activatedAt", "expiresAt"
FROM "Subscriber"
WHERE "userId" = 1
ORDER BY "createdAt" DESC;

SELECT id, kind, "addonKind", "purchasedAt", "expiresAt",
       "totalDataMb", "remainingDataMb", right(iccid, 4) AS iccid_suffix,
       "providerPurchaseId" AS telna_package_id,
       ("billingTransactionId" IS NOT NULL) AS has_payment_reference,
       ("provisioningError" IS NOT NULL) AS has_provisioning_error
FROM "MobileDataPackPurchase"
WHERE "userId" = 1
ORDER BY "purchasedAt" DESC, id DESC;

SELECT "purchaseId", status, "createdAt", "completedAt",
       right("oldIccid", 4) AS old_iccid_suffix,
       right("newIccid", 4) AS new_iccid_suffix
FROM "EsimReplacement"
WHERE "userId" = 1
ORDER BY "createdAt" DESC;

SELECT "userId", operation, "createdAt"
FROM "EsimOperationLock"
WHERE "userId" = 1;

ROLLBACK;
```

Confirm that a `Subscriber` owned by user 1 ends in **0813** and correlate each paid purchase to its ICCID suffix and Telna package ID. A payment reference in Chatforia is evidence of a recorded transaction, but it does not by itself prove current Telna service.

If the claimed payment has no `MobileDataPackPurchase` row, obtain the checkout session ID from the customer's existing receipt or a protected billing log. The already authenticated `GET /billing/checkout-status?session_id=<session>` checks Stripe payment state and whether a matching purchase was fulfilled for the signed-in account; it does not create a purchase. Reconcile the webhook outcome and any `EsimOperationLock` before considering a repair. Do not manufacture a queued package from the receipt alone.

For every recorded Telna package ID, use the production account's documented read-only package-retrieval operation (`GET /v2.1/pcr/packages/{packageId}` in the current adapter) or the Telna portal. Capture package status, template, owner ICCID suffix, remaining bytes, activation timing if supplied, and expiry. Compare these with Chatforia's records. `NOT_ACTIVE` establishes only provider lifecycle state; activation order and validity while queued still require Telna confirmation. Avoid `POST`, `PUT`, activation, suspension, or replacement calls.

After the review branches are deployed and a new iOS build is installed through the normal release process, an authenticated `GET /api/wireless/purchases` gives the customer-safe ledger view. The existing `GET /api/wireless/status` refreshes stored usage, so it is **not** a strict read-only reconciliation query.

## Automated verification and remaining QA

- Six focused server suites, including real PostgreSQL integration against a disposable localhost PostgreSQL 18 container with synthetic rows and mocked Telna, passed **140/140**. The new integration test verifies user scoping, multiple rows, and no ledger mutation.
- iOS simulator build and focused `WirelessServiceTests` plus `ESIMActivationViewModelTests` passed after these changes. No build was installed on the reported iPhone.
- The Wireless web dashboard tests passed **10/10**, and the production web build passed with the exact required arm64 Rollup and esbuild binaries installed in a separate temporary directory. Targeted ESLint found no errors in changed JavaScript files.
- The disposable full-migration replay stopped at the existing staff-security migration prerequisite; this incident's database-backed test used a fresh database created directly from the review schema. No production migration was attempted.
- Live account reconciliation, Telna package state, and physical-device display/transfer eligibility remain outstanding. Do not attempt a real transfer until Telna confirms multi-package entitlement preservation or the account has exactly one eligible package and the normal QA approval is given.
