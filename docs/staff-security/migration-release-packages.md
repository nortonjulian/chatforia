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
Historical checksum exceptions are deliberately unsupported by this strict runner.
The current four mismatches therefore block this entry point. Integrating the
existing target-bound exception requires the owner's risk decision and a separately
reviewed change; never edit the migration ledger to pass this check.

Each attempt gets a unique private archive directory with started.json, package.json,
before.json when preflight passes, and receipt.json. Receipts contain target, commit,
package digest, migration names/checksums, aggregate results, status and timestamps.
The database URL, credentials and raw Prisma logs are excluded. A failed migration
captures the remaining ledger if reachable. A crash may leave only started.json or
before.json: treat that attempt as incomplete and inspect the database before retry.
Verified receipts require all package migrations present with exact checksums and
successful after predicates. A post-check failure stops the process; it does not
reverse committed SQL. Follow the compatible recovery runbook.

The runner serializes its own deployment attempts with a database advisory lock.
Operational access controls must prohibit alternative concurrent migration commands.
Keep traffic fenced until receipt verification and application smoke tests pass.
The legacy backend workflow is blocked to prevent its checkout-based migration
command from bypassing this process. API installation/restart and credential cutover
remain separately reviewed operations in the deployment runbook.
