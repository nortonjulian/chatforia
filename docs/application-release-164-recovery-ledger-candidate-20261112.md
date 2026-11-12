# Application release 164: recovered Stage 5 ledger candidate

This branch is a **proposed source-gate correction**, not production approval.
It does not change migrations 162–164, their checksums, the approved v2 base,
the four accepted historical checksum exceptions, or the archived release
package and encrypted backup at `56fe5d914231b21608e6ba511daa0088efc501b7`.

The completed November 10 security handoff recorded **161 finished, four
rolled back, zero unfinished** migration rows. On November 12, an owner-approved
read-only query of the exact `defaultdb` target over verified TLS observed the
same counts and zero application migrations applied. The owner-only stop
receipt is `Chatforia-Deployment-Records/application-164-readonly-preflight-stop-20261112.json`.
The approved 56fe package expects only three rolled-back rows, so its package
preflight was stopped before invoking the runner. No migration or runtime
database preflight followed the failed gate.

The fourth row is the preserved failed attempt for
`20261102070000_staff_security_foundation` from the reviewed Stage 5 recovery
manifest. The candidate v3 manifest pins the **IDs, names, and checksums of all
four rolled-back rows** and requires each to remain rolled back and unfinished.
It retains the exact 161 active base and three pending application migrations.
The package builder still accepts the archived 56fe manifest only with its
original three-row rule. A different rollback row, duplicate ID, altered
checksum, extra/missing active migration, or altered SQL remains a stop.

## Current-main deployment guard

PR #327 advanced main to `21e521ca83916c4383ac05194f8cc5dd0d43fe9a`.
Its delta after 56fe contains only two launch-QA documentation files. The
protected `deploy-backend.yml` workflow and both Mac/host deployment scripts
require the release SHA to equal the **current main tip**. The 56fe package
cannot pass that guard; no exception should be added just for the docs change.
If this candidate is reviewed, approved, and merged, rebuild, archive, and
independently verify a new package at the **resulting full main commit**. Create
and independently read back a new encrypted release-package backup under a
new filename, preserving the 56fe package, backup, and receipts. Obtain a
separate owner decision for the new proposed four-row source gate, then a
separate production preflight and execution decision. Do not treat the prior
56fe source-gate approval as approval of this revision.

The deployment handoff remains verification-only and protected by
`production-api`. Its current-main, package-digest, and restricted-systemd
checks stay unchanged. No protected handoff, backup, production migration,
deployment, or writer stop is performed by this branch.

The read-only runtime inspection also found the active service running as
`chatforia-api:chatforia-api` from
`/var/www/chatforia-api-releases/c1037d7150e3bacbb50492ef92d20596d8c18d1f/app/server`.
The reviewed host deployment script currently requires its working directory
to be `/var/www/chatforia-api/server`. This is another explicit deployment
stop. Reconcile the actual release-directory layout and review a compatible
host procedure before deployment; do not change the live unit to satisfy the
script without a separate production approval.
