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

| Recorded migration | Expected current objects and reviewed catalog result |
| --- | --- |
| `20260726034500_add_wireless_refund_audit` | Nine refund/audit columns on `MobileDataPackPurchase`; integer refund amount/data defaults `0`, review flag default `false`; both refund-status/review indexes present and valid. |
| `20260806030000_add_pstn_reporting_and_blocking` | `Report.reportType` default `APP`, `reportedPhone`, `smsMessageId`, and nullable `messageId`; `SmsBlockedNumber` five columns, serial key, created-at default, three secondary/unique indexes; three Report indexes. `SmsBlockedNumber.userId` FK is CASCADE/CASCADE, `Report.smsMessageId` is SET NULL/CASCADE. All inspected objects match. |
| `20260807010000_add_sandbox_apns_tokens` | Two nullable Device sandbox token columns. The original non-unique indexes were superseded by two present, valid unique single-column indexes in the later migration. |
| `20261013_add_esim_replacement_audit` | `EsimReplacement` 25 columns, reason/status defaults `DEVICE_REPLACEMENT`/`PENDING`, created-at default, primary key plus seven intended indexes, four validated FKs. User FK is CASCADE/CASCADE; purchase and both Subscriber FKs are RESTRICT/CASCADE. All inspected objects match. |

## Exact evidence still needed before a reconciliation design

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
   metadata against the actual target. Confirm existing data invariants with
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
smallest non-disruptive prerequisite is an environment where a **new disposable**
PostgreSQL cluster can allocate SysV IPC, or a separately authorized isolated
Linux CI runner. Never use the production cluster or its logical test databases
for this role test.
