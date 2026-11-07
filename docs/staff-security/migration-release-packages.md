# Migration packages and receipts

PR #300 protects existing SQL at review time and provides a separate, explicit
deployment entry point. Require the `Append-only Prisma migrations` check on
main, restrict direct pushes, and protect workflow changes through review.

## Exact package generations

The retained 160-migration review package uses the unchanged v1 reconciliation
manifest and its original four historical checksum pairs. Keep its archived
bytes, checksum and recovery copy unchanged. A new release containing
`20261106010000_twilio_compliance_event_sid` uses the separate v2 manifest:
141 baseline + 19 staff + one consent migration, with the first 160 names and
SQL hashes pinned as a set and the consent SQL pinned to SHA-256
`3befceaba8f76df39c15a60cadcd8698f06c03ceee71c263210c62bff6dde78a`.
The package builder selects one manifest by the committed migration set; the
runner checks the same version in the archive, reviewed checkout and preflight.
The v2 manifest remains `proposed-not-authorized-for-production`. Its separate
approval and digest-pin review, exact-main package creation, independent
checksum verification and private backup/readback are still required before a
production window. Do not repurpose the old package or checksum. The local
Twilio release handoff is `docs/twilio-callback-release-handoff-20261106.md`
at commit `f49ed63a` until that documentation is separately published.

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
