# Four baseline migrations: evidence for reviewed reconciliation

The strict deployment preflight **continues to reject** the target baseline.
This report describes authorized read-only evidence only. No migration, ledger
entry, production file, service or database setting was changed. Hash pairs are
in [live inspection evidence](evidence/live-infrastructure-inspection.json);
the bounded [search result](evidence/migration-provenance-followup.json) contains
counts and outcomes without SQL bodies or customer data.

## Provenance search result

The offline tool checked every reachable Git revision touching each named file
(2/1/1/1 revisions); none matched the ledger hash. The current SQL appeared in
263 local Desktop worktree copies. A read-only scan of `/var/www`, `/opt`, `/srv`,
`/home`, `/root`, `/var/backups` and `/tmp` on the two confirmed Droplets inspected
10 API SQL copies, six API release/deployment/backup archives, five web archives
and four matching-named SQL members inside API archives. All available copies
had the **current** hashes; none had the recorded hashes. The GitHub repository's
workflow artifact inventory reports zero retained artifacts, as do the four
recent PR runs inspected. Search was bounded to these locations and file types;
an external backup/archive may still exist.

## Current catalog compared with current migration SQL

The existing 70 catalog checks covered expected named columns/types, index
columns/uniqueness/validity and named constraints: 68 direct matches. Two
non-unique Device indexes were correctly removed by the later completed
`20260807223500_unique_push_token_ownership` migration and replaced by valid
unique indexes. A further 32 focused checks of defaults, current index validity
and FK delete/update actions passed. This is evidence about **current schema**,
not proof of the original applied SQL or of every historical DDL side effect.
The [schema-only target catalog](evidence/migration-target-catalog.json) pins
215 column, index and constraint entries for these five tables. A fresh
`postgres:18.6` CI service reconstructs the available 141-file baseline and
compares those entries exactly; it also tests prepared role SQL and confirms
the four recorded hashes still fail strict preflight. No customer rows,
credentials or token values are in this fixture.

| Recorded migration | Expected current objects and reviewed catalog result |
| --- | --- |
| `20260726034500_add_wireless_refund_audit` | Nine refund/audit columns on `MobileDataPackPurchase`; integer refund amount/data defaults `0`, review flag default `false`; both refund-status/review indexes present and valid. |
| `20260806030000_add_pstn_reporting_and_blocking` | `Report.reportType` default `APP`, `reportedPhone`, `smsMessageId`, and nullable `messageId`; `SmsBlockedNumber` five columns, serial key, created-at default, three secondary/unique indexes; three Report indexes. `SmsBlockedNumber.userId` FK is CASCADE/CASCADE, `Report.smsMessageId` is SET NULL/CASCADE. All inspected objects match. |
| `20260807010000_add_sandbox_apns_tokens` | Two nullable Device sandbox token columns. The original non-unique indexes were superseded by two present, valid unique single-column indexes in the later migration. |
| `20261013_add_esim_replacement_audit` | `EsimReplacement` 25 columns, reason/status defaults `DEVICE_REPLACEMENT`/`PENDING`, created-at default, primary key plus seven intended indexes, four validated FKs. User FK is CASCADE/CASCADE; purchase and both Subscriber FKs are RESTRICT/CASCADE. All inspected objects match. |

## Per-migration reconciliation record

The available SQL is the current file at the linked path. Hashes below are
SHA-256 of SQL bytes, not hashes of customer data. No original applied file has
been found. Current catalog comparisons do not prove prior DML.

### `20260726034500_add_wireless_refund_audit`

- Recorded: `63434b2fb65211b9d6e4be08352ac66db4c7e209d1e20b67006022ba36d34767`.
  [Available SQL](../../server/prisma/migrations/20260726034500_add_wireless_refund_audit/migration.sql):
  `f20ce82990bc7627a5f1d485b0f43a4e36ebf81bba3e35482d086ba7166533ca`.
- Available SQL adds nine refund/audit fields to `MobileDataPackPurchase` and
  two indexes. Three `NOT NULL DEFAULT` additions give pre-existing rows logical
  values `0`, `0` and `false`; later refunds can change them. Current type,
  nullability, default and index checks match.
- Unknown: whether applied SQL contained another default, backfill, data
  correction, trigger or statement. Review original SQL and approved aggregate
  refund amount/data/currency/status invariants. Current values do not prove
  the historical backfill.

### `20260806030000_add_pstn_reporting_and_blocking`

- Recorded: `94fe6d123994ae57dffeca09dfa26539b3174725bad2ae3fd9efabcbd785785b`.
  [Available SQL](../../server/prisma/migrations/20260806030000_add_pstn_reporting_and_blocking/migration.sql):
  `19a1a154ba49a030dbe3aa4116c692b563e630ff6029656c5372a0d691a81cf1`.
- Available SQL adds Report phone/SMS/type fields, loosens `messageId`
  nullability, creates `SmsBlockedNumber`, three Report indexes, three blocked-
  number indexes and two FKs. `reportType NOT NULL DEFAULT 'APP'` gives older
  Report rows a logical `APP` value. The new table starts empty in this SQL.
  Current columns/defaults/indexes/FK actions match.
- Unknown: whether applied SQL reclassified reports, copied blocked numbers or
  changed relationships. Verify original DML and approved aggregate counts by
  report type, SMS linkage and invalid FK states.

### `20260807010000_add_sandbox_apns_tokens`

- Recorded: `164917910396613ca5934d542d661268ba88d506dddf3d9ad73965417a418ab7`.
  [Available SQL](../../server/prisma/migrations/20260807010000_add_sandbox_apns_tokens/migration.sql):
  `d2a68cbfbc475480b14b40d91ff1e591990e2ac144910cc8080689e9f609f271`.
- Available SQL adds two nullable Device token fields and two non-unique indexes.
  Existing rows gain null values unless another statement populated them. A
  later completed migration replaced the indexes with valid unique indexes;
  both columns and replacements match the current catalog.
- Unknown: whether applied SQL migrated live/sandbox tokens or cleaned up
  duplicates before unique ownership. Verify original SQL and approved
  aggregate duplicate/null/ownership invariants; never print token values.

### `20261013_add_esim_replacement_audit`

- Recorded: `3e95935c4c4646839fc532a7fd7f6565688fd1e52700612994494f3f5f79e3b3`.
  [Available SQL](../../server/prisma/migrations/20261013_add_esim_replacement_audit/migration.sql):
  `b2d299423e802dfb50958caa92c71813702c210df1ef7c84f039d3e22a1a39f4`.
- Available SQL creates `EsimReplacement` with 25 columns, a primary key,
  seven indexes and four FKs. It has no explicit `INSERT`/`UPDATE`/`DELETE`;
  defaults apply only to later inserts because the table is newly created.
  Current columns/defaults/indexes/FK actions match.
- Unknown: whether applied SQL imported prior events, seeded idempotency keys
  or altered provider-purchase ownership. Verify original SQL, approved
  aggregate duplicate/FK/orphan checks and audit chronology.

## Smallest justified reconciliation design

**Now:** leave the target ledger and strict preflight unchanged. Current schema
similarity is insufficient to approve an alternate baseline, ledger rewrite or
release. The isolated PG18 reconstruction uses **available** SQL and tests only
its compatibility and current catalog equivalence.

**If trusted original bytes are recovered:** an independent DBA and security
reviewer verify all four recorded SHA-256 values, provenance and full SQL deltas.
In fresh isolated PG18, apply the original 141-file baseline and compare schema
and approved aggregate invariants to the target. If compatible, prepare a pinned
release artifact containing those reviewed historical bytes for the four already-
applied migrations, leaving all 18 new staff migration bytes and target ledger
intact. The existing exact-hash preflight must pass against that artifact before
migration approval. Test empty and populated synthetic upgrades. If those
historical bytes break fresh installs, stop and review a separate design; do
not substitute a manifest waiver.

**Abort/rollback:** absent or untrusted bytes, hash mismatch, unexplained DML,
catalog difference, failed aggregate check, failing 141-entry preflight,
changed new-migration hash or unverified backup means NO-GO. Discard a failing
isolated artifact. If a later separately approved deployment fails after DDL,
keep ingress fenced and use compatible-code containment or separately approved
restore/reconciliation; never blindly run down migrations or pre-PR code.

## Exact evidence still needed to decide

1. Obtain the **original bytes** of each applied `migration.sql` from a trusted
   retained build/deployment package, independent repository object or migration
   job record. Record source, creation time, SHA-256 and chain of custody. A
   directory with the current bytes or a dump of the checksum column is not the
   original SQL. Avoid customer-data backups unless an approved custodian can
   extract only these four SQL files without exposing other contents.
2. Compare original and current SQL statements for all columns (type, nullability,
   defaults, generated/identity), indexes (definition, predicates, uniqueness,
   validity), constraints (columns, referenced keys, actions, validation),
   sequences/ownership, triggers and any data backfill. Include subsequent
   migrations that altered the same objects so current schema is not mistaken
   for the immediate post-migration state.
3. Reconstruct the 141-migration baseline in a **fresh isolated** PostgreSQL 18
   database using trusted applied artifacts, then compare schema-only catalog
   metadata against the actual target. CI reconstruction of **available** SQL
   is a compatibility test and cannot replace this historical test. Confirm
   existing data invariants with
   approved aggregate checks only; do not export customer rows into local QA.
   Review any divergence and a repair plan with a DBA/security reviewer.
4. Require a separately approved, rehearsed resolution with a recoverable
   pre-change backup and an exact audit trail. Do not run `migrate resolve`,
   edit `_prisma_migrations`, replace old SQL or weaken preflight merely to make
   the check pass. Until a legitimate resolution is approved, **NO-GO**.

## Local role-SQL test limitation

The prepared role script's static guard test passes. Its fresh PG18 execution
test cannot start because macOS `initdb` fails at `shmget(IPC_PRIVATE, 56)` with
`ENOMEM`. An independent 56-byte allocation gives the same result even outside
the sandbox; two existing 56-byte SysV segments were listed, and no shared
system setting was changed. This does not establish the underlying kernel cause.
The existing synthetic preview and production hosts were left untouched. The
standard public-repository CI runner now hosts a separate disposable
`postgres:18.6` container for role SQL and current-baseline reconstruction.
GitHub documents standard hosted runners as free for public repositories; the
CI result is recorded in PR #293. Never use the production cluster or its
logical test databases for this role test.
