# Migration packages and receipts

The [current-main activation adaptation](reconciliation-161-adaptation.md)
requires 161 migration SQL files, including an exact-hash Twilio migration.
The 160-file candidate described below is retained only as historical review
evidence; it cannot be the final release package.

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
The four-pair exception is integrated for review. The currently merged/released
package remains proposed; the separate activation branch applies the exact
status/pin patch for CI review only. Owner acceptance of historical uncertainty
for preparation is recorded in `migration-exception-review.md`; it does not
authorize production execution.
Without STAFF_MIGRATION_RECONCILIATION_ID, exact checksum matching remains the default.
With that ID, the runner requires the pinned manifest to have separate production
approval, archives the manifest and three evidence files, checks the exact target
including port, and verifies all four pairs plus every other migration normally.
The production CLI cannot use the isolated CI bypass. Before and after checks also
run the existing read-only catalog and data predicates. Receipts preserve the actual
historical ledger and identify the exception; no ledger checksum is rewritten.

PR #301's base manifest is `proposed-not-authorized-for-production`. The
separate activation branch sets `approved-for-production` in source and updates
both digest pins in staffMigrationReconciliation.js and migration-package.mjs.
Its CI/review, merge, new release and actual production execution remain
separate gates.
Do not set the exception environment variable on production as part of preparing this PR.
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

**Prepared backup path, not a completed final backup:** the currently archived
review package still contains the proposed manifest; no final activation release asset
or target receipt exists. The
[preparation receipt](evidence/final-release-backup-preparation-20261106.json)
records the current artifact state. The reviewed candidate's AES-256 iCloud Drive
image and successful read-back establish the storage method only. After a separately
approved activation commit is reviewed and merged, use a **new** archive release
from that exact main SHA. Confirm its checksum and package commit, inspect the
embedded manifest for `approved-for-production`, verify all 161 migration files
and compare the downloaded bytes with the reviewed release. Abort on any mismatch;
never relabel or reuse the candidate image or digest.

Stage the final package and checksum in an owner-only local directory outside the
checkout and API host. Create a new AES-256 encrypted disk image containing only
those verified files and a minimal nonsecret inventory. Name the image and
checksum sidecar with the full reviewed release commit; use different names for
later receipt images so no attempt can overwrite the package backup. Provide
its passphrase through hidden input from separately retained custody, never a
command argument, environment variable, log, PR or the image itself. Verify the
image checksum,
mount it read-only, compare the package and checksum byte-for-byte with the
downloaded source, run package verification on the mounted copy, then detach.
Keep the plaintext staging directory owner-only and local; remove it only under
the owner's later retention decision.

Upload **only** the encrypted image and its checksum sidecar to the existing
private iCloud Drive destination. The candidate's automatic sync was not visible
on iCloud.com, so verify the final image through an explicit web upload and a
separate download. Compare the returned image with the local digest, decrypt the
returned copy read-only, verify the package again and detach. Do not mark final
backup complete until this cloud read-back passes. After each authorized
preflight/execute attempt, make a new encrypted backup of its complete private
receipt directory and verify a separate read-back the same way. Preserve failed
and incomplete attempts. No production preflight, migration or exception
activation is authorized by these preparation steps.

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
