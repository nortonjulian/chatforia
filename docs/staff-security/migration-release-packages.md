# Migration packages and receipts

PR #300 protects existing SQL at review time and provides a separate, explicit
deployment entry point. Require the `Append-only Prisma migrations` check on
main, restrict direct pushes, and protect workflow changes through review.

## Archive before deployment

After merge and review, manually run **Archive migration release** with the full
approved main commit SHA. It reads Git objects, including exact SQL bytes, schema,
root lockfile and deployment-checks.json. Dirty worktree files cannot enter the
package. GitHub Release assets retain these files independently of the API host
without the automatic expiration of workflow artifacts. Restrict release deletion
permissions and retain an additional private backup according to company policy.
The workflow refuses to overwrite an existing release tag. It never migrates.

Download `migration-package.json` and its checksum from that release. Independently
review the release commit, package digest, migration SQL and check plan. Run the
operator from that same reviewed checkout with its locked dependencies installed.
Provision a private durable archive directory on the operator's machine or secure
mounted storage independent of the API host. The program checks that this directory
is outside the checkout; the operator must verify its storage location, backups and
access controls. Running it on the API host with a local directory does not meet
the independent-storage requirement.

## Review data effects

Every pending migration must have an entry in
`server/prisma/deployment-checks.json`. A schema change requires a reason and
preservation checks. A data change requires explicit expected before and after
aggregate results. Review SQL for unintended changes even when it is classified
as schema-only. Use counts, totals, null/duplicate checks and domain invariants
appropriate to the migration; never select customer rows, credentials or tokens.
The initial staff entries preserve the existing User count. This is a bounded
check, not proof of every row or field. Fence writes during the change window so
legitimate concurrent traffic does not invalidate comparisons.

## Preflight and execute

Load DATABASE_URL securely in the operator's environment with sslmode=require&sslaccept=strict
and an absolute provider CA path in sslcert. Keep it out of command history and receipts.
Supply independently verified target host/database values. For example:

```sh
node server/scripts/deploy-migration-package.mjs \
  --package /secure/downloads/migration-package.json \
  --sha256 REVIEWED_SHA256 \
  --host VERIFIED_DATABASE_HOST --database defaultdb \
  --archive /secure/independent-migration-archive
```

This defaults to preflight only. It archives the exact package and preflight
evidence, validates the active migration ledger and requires a reviewed plan for
every pending migration. After separate production approval, repeat with
`--execute`. It repeats all preflight checks and executes the installed, version-
checked Prisma CLI against the schema and SQL extracted from the archived package.
The existing staff prerequisite preflight also runs when staff migrations are pending.
The four-pair exception is integrated for review but remains blocked by the existing
production-approval gate. Owner acceptance of historical uncertainty is recorded in
`migration-exception-review.md`; it does not authorize production execution.
Without STAFF_MIGRATION_RECONCILIATION_ID, exact checksum matching remains the default.
With that ID, the runner requires the pinned manifest to have separate production
approval, archives the manifest and three evidence files, checks the exact target
including port, and verifies all four pairs plus every other migration normally.
The production CLI cannot use the isolated CI bypass. Before and after checks also
run the existing read-only catalog and data predicates. Receipts preserve the actual
historical ledger and identify the exception; no ledger checksum is rewritten.

The manifest remains `proposed-not-authorized-for-production`. A future separately
approved activation must update the manifest status and both digest pins in
staffMigrationReconciliation.js and migration-package.mjs through review and tests.
Do not set the production exception environment variable as part of preparing this PR.
Never edit the migration ledger to pass a check.

The [November 6 local candidate](evidence/recovery-package-local-20261106.json)
was built from committed Git objects and passed package and checksum verification.
Its 168 embedded files, including all 160 migrations, match the retained review
archive byte-for-byte. Its manifest is still proposed, so this candidate is
**not** a final production release or a substitute for a new archive from the
reviewed activation commit on `main`. Its owner-only `/private/tmp` directory is
temporary. An [encrypted iCloud Drive copy of this candidate](evidence/recovery-backup-icloud-20261106.json)
passed an owner-reported web read-back, image checksum, decryption and full
package verification; the final activation package and its private receipts
will still need their own backup and read-back.

Each attempt gets a unique private archive directory with started.json, package.json,
before.json when preflight passes, and receipt.json. Receipts contain target, commit,
package digest, migration names/checksums, aggregate results, status and timestamps.
The database URL, credentials and raw Prisma logs are excluded. A failed migration
captures the remaining ledger if reachable. A crash may leave only started.json or
before.json: treat that attempt as incomplete and inspect the database before retry.
Verified receipts require all package migrations present with exact checksums (or
only the four explicitly approved historical pairs when activated) and
successful after predicates. A post-check failure stops the process; it does not
reverse committed SQL. Follow the compatible recovery runbook.

The runner serializes its own deployment attempts with a database advisory lock.
Operational access controls must prohibit alternative concurrent migration commands.
Keep traffic fenced until receipt verification and application smoke tests pass.
The legacy backend workflow is blocked to prevent its checkout-based migration
command from bypassing this process. API installation/restart and credential cutover
remain separately reviewed operations in the deployment runbook.

## Private custody of final package and receipts

No real target receipt exists before an authorized preflight. Do not create a
placeholder receipt that appears to certify production. The isolated PostgreSQL
18 receipt-generation step passed in [PR verification run #174](https://github.com/nortonjulian/chatforia/actions/runs/42170718022);
that is a synthetic test, not target evidence.

For the final activation release, retain the package JSON and checksum from the
new GitHub Release plus each complete private attempt directory produced by the
runner. Keep the runner's `started.json`, archived `package.json`, `before.json`
when present, and `receipt.json` together. Preserve failed and incomplete
attempts too. Copy the whole set to an independently durable, access-controlled
private location outside the checkout and API host. Verify a **read-back** copy
against locally recorded SHA-256 digests for every file and confirm directory/
file permissions remain owner-only. Keep any database aggregates and target
metadata in that private store; public review records should contain only the
package SHA, receipt status, timestamps and a redacted backup-verification result.
Do not put credentials, key values, customer rows or private receipts in GitHub.
