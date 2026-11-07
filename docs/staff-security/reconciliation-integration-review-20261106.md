# 161-migration reconciliation integration — review only

This integration combines the technical checks from `3d57aa5a` with the Founder
Control activation branch at `e114a9cf`. It does not activate the historical
checksum exception or authorize a production action.

## Exact package generations

- The archived 160-migration package and `staffMigrationReconciliation.v1.json`
  remain byte-for-byte unchanged. V1 keeps its original target, four checksum
  pairs, 141/160 active counts, and rejection of rolled-back ledger rows.
- The new 161-migration path uses `staffMigrationReconciliation.v2.json` with
  its own ID and independent digest pins. It requires the exact first 160
  migration names and SQL hashes, the exact Twilio consent SQL hash, 141 active
  baseline rows plus three inert historical rollbacks before execution, and
  161 active rows plus the same rollback records afterward. The package builder
  selects exactly one manifest; the runner and preflight check the same version.
  V2 remains `proposed-not-authorized-for-production`.
- The Founder branch's PostgreSQL 18 fixture fix targets the active ledger row
  by ID, so a synthetic tamper/restore test cannot alter a separate historical
  rollback row with the same migration name. The dual-version tests retain the
  Founder's missing, extra and finished-rollback rejection cases in V2.

## Decision still required

The Founder branch changed V1 in place to 161 migrations and marked its source
`approved-for-production` for CI/review. That conflicts with preserving the
archived V1 package and cannot be carried over silently to V2. The owner must
separately decide whether to approve the **V2** target-bound four-pair exception
for production after review of its ID, target, SQL/evidence hashes, three
historical rollback records and residual unavailable-SQL risk. If approved,
a separate reviewed change must update only V2's status and both independent
digest pins, with disposable PostgreSQL 18 CI passing on its final commit.
Until then the production runner rejects the exception. Strict checksum
validation remains the default without an explicit reconciliation ID.

Only after the reviewed activation change is merged to main may a new exact-main
package be archived, independently checked, privately backed up and read back.
The retained 160-file archive and encrypted candidate remain historical evidence.
The Stage 5 NO-GO and separate migration, runtime, recovery and ingress approvals
remain in force.
