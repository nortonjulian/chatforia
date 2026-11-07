# Exact four-pair activation proposal — review only

Prepared against PR #301 commit `3cf4b2f4baa462238aa63a2132370b87c61577cf`.
The [reviewed patch](reconciliation-activation-proposed.patch) is the exact
four-file source change applied on the separate activation branch in code commit
`c19542aa`. Its SHA-256 is
`91939cb2301df64980d204a508de0ad1fdc6987686d17160a0a66b6ccab076d0`.
The patch uses zero context to keep it whitespace-clean in the PR; verify the
base commit and apply it only with `git apply --unidiff-zero` after approval.
The PR #301 base manifest remains `proposed-not-authorized-for-production`.
This activation branch has `approved-for-production` **source bytes for CI and
review only**. No merged activation release exists, and the owner has not
authorized production preflight, migration, role provisioning or deployment.

## Exact boundary

The required ID is `chatforia-defaultdb-four-hash-20261103-v1`. The manifest
pins only `chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb`,
141 completed baseline migrations and 160 after the 19 staff migrations. Its
proposed activated SHA-256 is
`735ea2b62888a016de83bc5ac4b2acb34a455bae51310d8025e0923ebc153256`.
The patch changes the manifest status to `approved-for-production`, updates
that digest in both independent code pins, and changes the isolated PostgreSQL
18 test to exercise the approved path without the proposed-only CI allowance.
It makes no SQL, ledger, role or evidence-file change. Exact-checksum matching
remains the default when `STAFF_MIGRATION_RECONCILIATION_ID` is absent.

| Migration | Recorded active-ledger SHA-256 accepted for this name | Available SQL SHA-256 required in the release | Current evidence and unresolved history |
| --- | --- | --- | --- |
| `20260726034500_add_wireless_refund_audit` | `63434b2fb65211b9d6e4be08352ac66db4c7e209d1e20b67006022ba36d34767` | `f20ce82990bc7627a5f1d485b0f43a4e36ebf81bba3e35482d086ba7166533ca` | Current refund fields/defaults/indexes and nonnegative/non-null predicates match; one reviewed refund matched its test payment. The unavailable SQL might have performed a different backfill or correction. |
| `20260806030000_add_pstn_reporting_and_blocking` | `94fe6d123994ae57dffeca09dfa26539b3174725bad2ae3fd9efabcbd785785b` | `19a1a154ba49a030dbe3aa4116c692b563e630ff6029656c5372a0d691a81cf1` | Current Report and blocked-number objects, types and links match. The unavailable SQL might have reclassified old reports or copied blocked numbers. |
| `20260807010000_add_sandbox_apns_tokens` | `164917910396613ca5934d542d661268ba88d506dddf3d9ad73965417a418ab7` | `d2a68cbfbc475480b14b40d91ff1e591990e2ac144910cc8080689e9f609f271` | Sandbox token columns and later replacement unique indexes match; present-token uniqueness passes. The unavailable SQL might have transferred, cleared or deduplicated older token values. |
| `20261013_add_esim_replacement_audit` | `3e95935c4c4646839fc532a7fd7f6565688fd1e52700612994494f3f5f79e3b3` | `b2d299423e802dfb50958caa92c71813702c210df1ef7c84f039d3e22a1a39f4` | Current replacement table/indexes/FKs and bounded balance/owner predicates match; no replacement rows were observed. The unavailable SQL might have imported historical events or seeded idempotency data. |

These are **ledger/file pairs**, not claims that the SQL bodies are equivalent.
The original applied SQL remains unavailable. Current schema and bounded data
checks cannot prove what historical data transformations ran or whether later
activity masked an omission. The owner's earlier risk acceptance covered
preparation only; production use needs a new explicit decision.

## Checks retained after activation

- `assertReconciliationRequested` requires the exact ID, approved manifest
  digest, database name, URL hostname and port. The package CLI supplies no
  proposed-state test bypass, and its connection must use strict TLS identity.
- The archived package must contain the same manifest and three hash-pinned
  evidence files as the reviewed checkout. A changed manifest, evidence file,
  available SQL file or package digest fails before migration.
- The preflight requires exactly 141 completed baseline rows; the final check
  requires exactly 160. Missing, extra, duplicate, rolled-back or unfinished
  active entries fail. Only the four named recorded/available pairs are compared
  by temporary **in-memory** normalization. The other 137 baseline rows and all
  19 new staff rows still require exact file/ledger SHA-256 matching. A fifth
  mismatch fails; the target ledger is never rewritten.
- Read-only catalog comparison and the four groups of bounded current-data
  predicates must pass both before and after. The migration package also
  requires reviewed before/after aggregate checks for every pending migration,
  an independent receipt archive, and a verified final receipt. Passing these
  checks does not prove the missing original SQL or authorize execution.

## Preparation verification and approval boundary

The patch passed `git apply --unidiff-zero --check` against its base without
being applied.
An owner-only isolated copy with the proposed activated bytes passed five
package unit tests. A real-file synthetic package/ledger preview accepted the
four pairs at 141/160 and rejected strict-default use, a fifth mismatch, a new
staff checksum change, missing/extra rows and the wrong port. The preview gate
accepted the exact ID/target and rejected missing/wrong IDs and wrong host.
The CI test file parsed successfully. PR #301 PostgreSQL 18 CI tested the
proposed-state mechanism; the activated branch requires its own CI result.
No production database was accessed for this preview.

The owner accepted the four named historical-data uncertainties **for production
preparation** and authorized applying this exact patch on a separate branch for
code review and isolated CI. That decision is now reflected in code commit
`c19542aa`; it does not authorize a merge. A later explicit merge decision, a
new immutable release/archive and independently verified encrypted cloud backup,
and separate production preflight/migration approvals remain required. If the
base code, target, evidence, SQL or patch changes, regenerate the digest and seek
review again. Do not apply this patch directly on a production host.
