# Four-migration exception: owner acceptance and review record

## Authorization boundary

On November 4, 2026 (owner local date; November 5 UTC), Julian Norton stated:

> I accept the remaining historical-data uncertainty for the four documented migration mismatches and authorize preparing the exception for review. This does not authorize merging or production deployment.

This accepts the documented uncertainty and authorizes preparation on PR #300 only.
It does not authorize a merge, production migration, exception activation, database
ledger modification, credential cutover, restart, or deployment. No production
operation was performed in preparing this change. The manifest retains
`proposed-not-authorized-for-production`; its status and checksum pins are unchanged.

## Exact scope

Manifest: `server/security/staffMigrationReconciliation.v1.json`

ID: `chatforia-defaultdb-four-hash-20261103-v1`

SHA-256: `a59c5f947c0d2059c98f67e85230b74d6ceccfbc9d778e44278680983e2630e5`

Target: `chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb`.
The manifest defines the only permitted recorded/available checksum pairs for:

- `20260726034500_add_wireless_refund_audit`
- `20260806030000_add_pstn_reporting_and_blocking`
- `20260807010000_add_sandbox_apns_tokens`
- `20261013_add_esim_replacement_audit`

The baseline has 141 migrations; the reviewed staff release has 160, including 19
new staff migrations. A fifth mismatch, changed pair, wrong target, altered evidence,
missing/extra/duplicate/unfinished migration, or modified new migration must fail.
The exception does not permit rerunning old SQL or rewriting the migration ledger.
Normalization for comparison occurs only on copies in memory.

## Evidence and limits

Earlier isolated PostgreSQL 18 reconstruction matched all 215 collected schema
entries and bounded current-data predicates passed. Original historical SQL remains
unavailable; this cannot establish whether old scripts backfilled, reclassified,
copied, or removed historical records.

During the owner-operated read-only investigation on November 4:

- Production contained 14 mobile-data purchases, one with refund activity and zero
  requiring refund review. The exact stored payment reference matched a Stripe
  test-mode transaction for a Local 3GB pack. Both showed USD 14.99 refunded,
  purchased at 2026-07-26T03:24:44.092Z and refunded at
  2026-07-26T04:17:46.000Z (Stripe displayed minute precision). Application status
  was FULL_APPLIED; refunded data was 3072 MB. The stored refund ID was absent,
  while the event, payment and charge references were present. This establishes
  the match for this record; it does not prove the cause of the absent refund ID.
- No EsimReplacement rows were present. Profile options had been observed, but
  a completed end-to-end replacement was not established.
- A hosted restore was readable with 141 completed migrations and the known QA
  account. This was a basic recovery check, not exhaustive integrity verification
  or a measured recovery-time test. The owner subsequently deleted the test cluster.

These are owner-supplied query results and screenshots, not newly performed automated
production checks. Payment identifiers and customer details are intentionally omitted.
They reduce specific uncertainty without proving every historical record correct.

## Review and remaining gates

The packaged runner now carries the pinned manifest and evidence, validates the
complete ledger before and after, preserves the original ledger in receipts, and
invokes the existing catalog/data checks when an approved exception is requested.
Strict matching remains the default and the production status gate remains closed.
Tests exercise the proposed exception only in isolated fixtures/CI.

The [exact activation proposal](reconciliation-activation-proposal.md) contains
the unapplied four-file patch, proposed new digest, retained checks and the
remaining per-migration historical uncertainty. Production-risk acceptance
would authorize review of that change only; it does not itself activate it.
Before production: separately approve activation, review its CI, obtain an
explicit merge decision, then approve the production change window.
Refresh backup/recovery readiness for that window, provision independent private
receipt storage and restricted roles/secrets, and follow the deployment runbook.
The owner is the identified rollout operator and stop authority. This record alone
opens none of those operational gates.
