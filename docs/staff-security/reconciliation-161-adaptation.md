# Activation adaptation for current main — review only

Current main at preparation: `b34211a4f09aac2600a7bf3f29295e394ab3affd`.
The owner authorized adapting the separate activation branch to the new
161-migration set for review and isolated CI only. This document supersedes the
160-migration counts in the [original exact-patch proposal](reconciliation-activation-proposal.md);
the original patch and its commit remain preserved. No production preflight,
migration, role provisioning, deployment, merge or restore is authorized.

## Scope of the adaptation

- The target and explicit ID remain exactly
  `chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb`
  and `chatforia-defaultdb-four-hash-20261103-v1`. The four historical
  recorded/available pairs and their evidence digests are unchanged. No fifth
  checksum exception is introduced.
- Main added `20261106010000_twilio_compliance_event_sid`. It is **not** an
  exception. The manifest pins its available SQL SHA-256 exactly as
  `3befceaba8f76df39c15a60cadcd8698f06c03ceee71c263210c62bff6dde78a`.
  The archived file must have those bytes before execution; its active ledger
  row must match that hash afterward. A changed file, changed ledger hash or
  missing/extra later migration fails. Main's reviewed aggregate-check plan
  includes this migration.
- The target evidence records 141 active baseline rows and three historical
  rolled-back attempts. The package checker now requires **exactly three**
  rolled-back rows with no finished timestamp, excludes them from the active
  comparison, and keeps their IDs/checksums/rollback timestamps in private receipts.
  Execution compares the complete rolled-back subset before and after and
  fails if any entry changes. A fourth, missing or unexpectedly finished
  rollback row fails. This preserves historical records without allowing a
  fifth active checksum mismatch.
- The post-release active count is 161: 141 baseline + 19 staff + one Twilio.
  Before execution, exactly 141 baseline rows must be active and 20 migrations
  must be pending. After execution, all 161 active ledger/file hashes are
  checked; only the four named baseline pairs are compared by in-memory
  normalization. Strict exact matching remains the default without the ID.
- The manifest's new SHA-256 is
  `94efe3ca09f6c316fbe5d498a609e85731d67de0c195e9d3a09336481485fd71`,
  pinned independently in the request gate and package checker. The target
  ledger and original SQL files are never rewritten.

## Review and release boundary

The branch merged current main to obtain the Twilio SQL, schema, checks and
security changes. The sole content conflict in the PostgreSQL 18 reconciliation
test was resolved to exercise the **full 161-file package**. The disposable
test now includes three synthetic historical rollback rows and verifies they
remain unchanged; it tests wrong targets/IDs, the four allowed pairs, changed
files/ledger entries, missing/extra/unfinished entries, a fifth mismatch,
and altered Twilio file or ledger hash. The migration runner still requires
strict TLS, a separately verified target, read-only preflight, complete
receipts and all aggregate/catalog/data predicates.

Local preparation passed 5/5 migration-package tests and 3/3 staff-release
checks. A committed-byte local preview package contained 169 files and all
161 migrations; a synthetic ledger check accepted 141 active + three historical
rollbacks before and 161 active + the same three after, while strict default
rejected the four mismatches. This preview is **not** a final release or a
production receipt. Disposable PostgreSQL 18 and PR CI results must be recorded
on the final pushed branch before any merge decision.

At the production window, any difference from the pinned target, migration
set, four pairs, one exact Twilio hash, three historical rollback rows, catalog,
data predicates or aggregate checks is an abort. The owner must separately
approve merge, create and read back a new encrypted final release package,
approve the temporary fence/recovery point, roles and credentials, preflight,
migration, runtime cutover and rollback plan. Historical SQL uncertainty remains
accepted for preparation only.
