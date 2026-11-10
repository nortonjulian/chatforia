# Stage 5 foundation migration recovery — prepared, not authorized

## Incident state and cause

The fixed `c1037d7150e3bacbb50492ef92d20596d8c18d1f` release package (SHA-256 `b1322c1e57ae579e7f6e3e03b784fcfbc88211fa117c3a7ac3e5d6604adf78ae`) reached **143 active, 3 rolled back, 1 unfinished** migration records on November 10. The old API and standing firewall were restored; public health and the Better Stack monitor returned Up. No founder activation or restricted API switch occurred.

`20261102070000_staff_security_foundation` starts with a guard against `information_schema.schemata`. PostgreSQL hides `staff_security` there from `doadmin` because the schema is owned by `chatforia_staff_owner`, and `doadmin`'s existing `SET TRUE, INHERIT FALSE` membership does not provide implicit schema `USAGE`. The schema exists in `pg_namespace` with the expected owner. The first guard raised SQLSTATE `P0001` **before** any DDL in that migration. The private failure log and read-only catalog check found zero `staff_security` relations/functions. The two earlier successful migrations created `StaffAssignment`, `StaffAccessEvent`, and `FounderOwnership`; all three contained zero rows. Their SQL contains table/index/constraint creation and no data update. The original failed record is retained, not rewritten.

An isolated PostgreSQL 18.6 replay found a second constraint: a schema-only `USAGE, CREATE` grant makes the first guard pass, but `ALTER TABLE ... OWNER TO chatforia_staff_owner` then removes the executor's owner authority, and the migration's subsequent `REVOKE` fails with SQLSTATE `42501`. The tested correction temporarily changes **only the existing doadmin → chatforia_staff_owner membership's `INHERIT` option to TRUE**. `doadmin` already has `SET` on that role; the runtime login receives no new membership or schema `CREATE`. The option is restored to FALSE immediately after the migration attempt, including on failure. Because the current API still uses `doadmin`, this temporary inheritance is permissible only after all API processes, jobs, and other database writers are stopped and public traffic is fenced.

## Prepared, target-bound files

- `server/security/stage5MigrationRecovery.v1.json` pins the c103 release/package, target, the three preexisting rollback rows, two newly completed rows, and original failed row by ID and checksum. Its status explicitly says production execution is **not authorized**.
- `server/scripts/staff-stage5-recovery-history.mjs` verifies the exact 143/3/1, 143/4/0, and 161/4/0 ledger shapes. It requires all four original historical checksum pairs, validates every other active migration against the unchanged 161 SQL files, rejects extra/missing/changed/unfinished rows, and preserves the failed row.
- `server/scripts/staff-stage5-recovery-preflight.mjs` is read-only. It requires both explicit IDs, the c103 package SHA, pinned database/host/port, strict TLS identity, PostgreSQL 18, `doadmin`, catalog/data invariants, and phase-specific role/schema checks. It does not resolve or execute a migration.
- Each preflight phase writes a private owner-only receipt outside the checkout. The `resolved` and `complete` phases require the `failed`-phase receipt and verify that the `User` row count remains unchanged; the aggregate is not printed to standard output.
- `server/scripts/staff-stage5-recovery-enable-executor-inherit.sql` and `staff-stage5-recovery-disable-executor-inherit.sql` are separately guarded write scripts. The disable script deliberately accepts a partial ledger so emergency privilege cleanup remains possible.

This is an **explicit, separately reviewed incident route**. The ordinary v2 package runner remains unchanged and correctly rejects the partial ledger. Neither the four historical exceptions nor any of the 161 migration SQL files changes. The c103 release archive and its verified encrypted backup remain the fixed package and evidence; the new recovery code must itself be reviewed and made available to the operator before use.

## Isolated test results

PostgreSQL **18.6** in a fresh local container, with a non-superuser `CREATEROLE`/`CREATEDB` executor, the two observed owner-membership edges, `NOINHERIT` staff owner, restricted runtime role, and synthetic data:

The isolated container uses loopback-only networking and a passwordless synthetic test login. This tests PostgreSQL role privileges and migration behavior, not production authentication or network access.

1. Applied the 141 baseline migrations, four target-shaped historical checksum pairs, and three inert rollback records; reproduced the original first two completed migrations and the exact 143/3/1 `P0001` failure. No foundation object or staff row appeared.
2. Verified that schema `USAGE, CREATE` alone reaches a second `42501` failure at `assertion_secrets` after owner transfer. That failed experiment is disposable only; a schema-only grant is not the production fix.
3. Temporarily enabled inheritance on the executor's existing staff-owner membership, marked the failed attempt rolled back through Prisma's `migrate resolve`, then applied the unchanged remaining 18 migrations. Final fixture ledger: **161 active, 4 rolled back, 0 unfinished**. The failed row remained visible; all new staff tables were owner-owned. Restoring `INHERIT FALSE` removed implicit executor schema rights. Runtime schema `CREATE`, direct staff-assignment updates, staff-event inserts, and `User.role` updates were denied.
4. The guarded enable/disable SQL scripts passed as a non-superuser on a separate 143/3/1 fixture, with only the synthetic executor name and generated failed-record ID substituted. The disable script passed while the failed row remained unfinished.
   The enable script also rejected a deliberately held second executor session; after closing that session it passed. The disable script passed again at 143/4/0.
5. The read-only recovery preflight passed against isolated PostgreSQL 18 in all three phases: failed **143/3/1**, resolved **143/4/0**, and complete **161/4/0**. The complete-phase test also passed the existing catalog/data invariants and runtime boundary.
6. The pure recovery-history regression tests passed 2/2, including wrong target, changed package, ledger IDs/checksums, additional failures, and missing rows. The checker also matched the preserved private production failure receipt exactly: 143/3/1 and 18 pending. Targeted ESLint and `node --check` passed for the new scripts.

The local replay proves SQL and PostgreSQL 18 behavior. It is not production execution approval, a production restore rehearsal, or proof that the live ledger remained unchanged after the final incident read.

## Independent cleanup correction and executable procedure

The November 10 independent review found that the original prose-only cleanup
sequence was not enforced, and the original disable transaction could roll back
its own privilege reduction when an unrelated postcondition failed. The corrected
`staff-stage5-recovery-disable-executor-inherit.sql` now commits **only** the
existing self-granted membership's `INHERIT FALSE` change before verifying the
remaining invariants. It accepts an already-disabled edge, never creates a missing
edge, and reports drift after the reduction is committed. Do not wrap this script
in an outer transaction or invoke psql with `--single-transaction`.

Use `server/scripts/staff-stage5-recovery-run.mjs` for steps 4–9 below; these steps
are the behavioral specification, not a request to improvise a manual sequence.
The adapter uses the existing pinned c103 package and recovery manifest. It
extracts the hash-verified package into a private temporary directory, enforces
Prisma's locked version, pins the datasource and public ledger, and uses the same
target and CA for Prisma and psql (libpq `verify-full`). Neither SQL files nor the
four-exception manifest are edited. The operator must have `psql` available.

After a separately approved staffed window, the writer-stop checks, and a new
independently readable backup of 143/3/1, run from the reviewed checkout root:

```sh
node server/scripts/staff-stage5-recovery-run.mjs \
  --package /absolute/path/to/verified-c103-package.json \
  --archive /absolute/path/to/private-recovery-receipts \
  --deadline 'OWNER_APPROVED_ISO_TIMESTAMP_WITH_TIMEZONE' \
  --execute
```

The paths and timestamp above are placeholders, not an executable approval.
Privately provision `DATABASE_URL`, `STAFF_STAGE5_RECOVERY_ID`, and
`STAFF_MIGRATION_RECONCILIATION_ID` as in the read-only gate. The CA path must be
absolute. The runner rejects alternate datasource URLs, duplicate/unreviewed
connection options, and a non-public schema. The receipt directory must be
owner-only and outside the checkout. The runner does not fence traffic, stop
writers, create backups, activate founder, switch APIs, or reopen traffic.
Those remain the approved operator procedure's checkpoints.

The runner reserves 20 minutes before enable and 14 before deploy; commands have
bounded timeouts and no automatic retries. Cleanup is armed **before** enable,
including a lost enable acknowledgement. It runs after caught enable/resolve/gate/
deploy failures. SIGINT/SIGTERM prevent further steps after the current child
finishes (or times out); cleanup is then attempted. Do not interpret Ctrl-C as an
immediate database rollback. No JavaScript `finally` can survive SIGKILL, host
failure, or a lost database connection. In those cases keep writers stopped and
traffic fenced, inspect the membership read-only, and use the reviewed idempotent
disable script through the verified connection. Never restart the old doadmin API
while temporary inheritance remains enabled or unverified.

A failure retains `stage5-recovery.lock` in the private receipt directory and
stage receipts. Do not delete that lock to retry; review the new ledger and
cleanup status first. Any cleanup diagnostic failure blocks the success gate,
even when the privilege reduction itself committed. The complete phase additionally
checks protected runtime writes and staff table ownership. Existing after-migration
preflight runs before the tool reports success. Further focused database tests and
API acceptance remain required before cutover.

The committed PostgreSQL rehearsal now calls the **actual guarded scripts** using
only a synthetic role name and generated failed-row ID substitution, and the same
sequence module used by the runner. It covers repeated cleanup, a second executor
session, unrelated runtime-membership drift during cleanup, a failure before
resolve, a failure after resolve, and a real later migration error in a disposable
copy. Repository migration SQL remains unchanged. The three scenarios are wired
into `.github/workflows/stage5-recovery-rehearsal.yml` with fresh PostgreSQL 18.6
services and no production credentials.

See `evidence/stage5-recovery-cleanup-review-20261110.json` for independently run
local results. These tests cover the shared sequence and SQL, not a live managed
cluster execution or full production API cutover.

## Exact proposed production sequence — requires separate approval

1. **New staffed window and baseline.** Confirm current monitor/public health, unchanged standing firewall, c103 archive and cloud readback, recovery-key retrieval, and owner Recovery Console access. Recheck the _current_ ledger and role graph read-only; stop if they differ from 143/3/1 and the pinned IDs. Check the time immediately before every disruptive action and reserve enough time to restore public access by the approved deadline. No old window carries forward automatically.
2. **Fence and stop writers.** Use the previously tested operator HTTPS Allow and 22-CIDR Cloudflare HTTPS Deny sequence, preserving SSH and HTTP 80 ACME routing. Prove public denial, operator HTTPS/SSH, then stop PM2 API/startup and all jobs or other database writers. Verify port 5002 absent and no application `doadmin` sessions. Do not alter the membership while the old API is running.
3. **New recovery point.** Confirm selectable PITR at this stopped-writer time and create a fresh encrypted, independently readable off-host backup of the **current 143/3/1 state**. Preserve both the older pre-SQL image and all private incident receipts. Abort before any SQL if the new backup or read-back fails. A complete managed-cluster restore remains unmeasured.
4. **Read-only incident gate.** Run the new preflight in `failed` phase against the exact c103 package using the production-managed hostname with strict TLS and the explicit recovery and v2 reconciliation IDs. It must pass 143/3/1, empty foundation schema, empty new staff tables, exact IDs/checksums and catalog/data invariants. Capture a private before receipt, including the reviewed `preserve_user_count` aggregate. Stop on any difference.
5. **Temporary executor option.** Run the guarded enable SQL as `doadmin`; it requires no other `doadmin` client session and verifies only its existing staff-owner membership changed from `INHERIT FALSE` to TRUE. No runtime login or recovery login receives membership. Keep all writers stopped.
6. **Preserve and resolve the failed attempt.** Run Prisma 6.17.1 `migrate resolve --rolled-back 20261102070000_staff_security_foundation` from the pinned release migration directory. This sets `rolled_back_at` on the original failed row while retaining its ID, checksum, and failure log; it does not delete the row or mark the migration applied. Run the read-only `resolved` gate and require **143/4/0**, the same failed ID/checksum, zero foundation objects, and all other rows unchanged. Stop if this fails.
7. **Apply remaining migrations once.** Reverify c103 package hash and the 161 exact SQL files. Invoke Prisma 6.17.1 `migrate deploy` from that extracted package. The separate incident gate is an intentionally reviewed replacement for the ordinary package runner's 141/3/0 entry check; its ledger and target checks remain strict. No file/checksum edits or direct ledger updates are permitted. Require all **18** pending migrations to finish; do not retry a partial failure.
8. **Always restore the owner edge first.** Run the guarded disable SQL whether migration deploy succeeded or failed. Verify the original two owner-membership edges, `INHERIT FALSE`, no implicit `doadmin` schema `USAGE/CREATE`, and no runtime/recovery cross-membership. If SQL failed, preserve diagnostics and ledger; do not start the new API or bootstrap founder.
9. **Success gate.** Run the read-only `complete` check: **161/4/0**, original failed row retained as rolled back, new successful foundation row at its exact package checksum, all other active checksums exact except the four reviewed historical pairs, ownership/ACL isolation, and unchanged before/after user-count aggregate. Run the existing after-migrations preflight and focused staff database permission tests. Only a separately approved cutover phase may then activate the signing key/founder and switch the API.
10. **Restore public access or stop.** If any gate fails, keep new staff features inactive, reverse the temporary owner edge, and follow a separately approved old-API restoration if it remains compatible. Remove temporary firewall rules in the approved order and verify public health/monitor. Never edit the ledger to force a green preflight. If SQL has changed data/schema beyond the old API's safe compatibility, use the reviewed PITR/new-cluster recovery path; the restore duration and cost are not yet measured.

**Abort immediately** for an expired deadline, changed target/package/ledger, non-empty foundation objects before resolution, failed backup, unexpected role graph, inability to restore `INHERIT FALSE`, migration failure, failed data/permission checks, or loss of SSH/operator HTTPS/HTTP 80 renewal routing. A new production approval must specify the window, interruption/restore risk, and whether incident-only old-API restoration is authorized if the resumed SQL fails. This document grants none of those actions.
