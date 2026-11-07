# Stage 5 consolidated cutover approval proposal — review only

Prepared November 7, 2026 from merged main `b94b1891e5bca49f153c3548a6caa773e4599918`
and the separate v2 activation branch. This is an approval packet, not authority
to run any command against production. Stage 6 staff admission is excluded.
The owner is the release operator and stop authority. Existing sole-owner
recovery uses separate restricted credentials and sessions, not two people.

## Release identity and current hold

- The [superseded 161-file in-place-v1 archive](https://github.com/nortonjulian/chatforia/releases/tag/migrations-026b1c92468885615484c6c6cfb9a334be39bbf3)
  at `026b1c92` has package SHA-256
  `f0170569639c4420e2e2044a90261396257a5f4043c3b81764f286eb955c6e43`.
  Its owner-only AES-256 image SHA-256 is
  `da7172f54f1d4851b2bb9d37f8ae88e6429c93f68a72b9cadc3d4cf42fcd2b2e`.
  The package and image passed checksum, local read-only mount, owner-reported
  iCloud.com upload/download, separate downloaded-image decryption with the
  saved Apple Passwords passphrase, and byte-for-byte package read-back.
  The private receipt is outside GitHub. Preserve this archive and backup as
  historical evidence; **do not execute it against the current code**.
- [Main PR #307](https://github.com/nortonjulian/chatforia/pull/307) restored
  archived v1's exact 160-file manifest and introduced a distinct 161-file v2
  manifest. V2 remains proposed on main. The review-only v2 activation branch
  changes only its status and two independent digest pins and exercises the
  activated path in disposable PostgreSQL 18. V1 bytes, migration SQL, ledger
  records, four reviewed historical pairs, target and evidence are unchanged.
- No final v2 archive or cloud backup exists. After a separate v2 merge decision,
  archive **that resulting main SHA**, verify the 161 SQL files, exact 160-file
  legacy set, exact Twilio checksum, four pairs, three inert rollback records,
  v2 ID/status and package digest. Encrypt and independently read back the new
  package before any production fence, role change, preflight or migration.
  Never relabel the `026b1c92` archive or reuse its digest.

## One proposed production decision, only after the holds below close

The owner may approve one bounded cutover window covering orders 1–9 below,
with a stop after every order. Approval of this packet would not authorize
Stage 6 admission, a paid restore cluster, a different SQL/package/target,
unreviewed repair, or reusing the old privileged runtime. Record the exact
window, maximum acceptable interruption, current-main/release SHA and digest,
private founder ID, alert destination and recovery-risk choice in the private
execution record before requesting that approval. An approval with any field
missing is not executable.

**Interruption risk:** The temporary API HTTPS fence blocks normal browser API
traffic and provider callbacks; the static website can still load. Plan an
off-peak four-hour reserved window, with provider retry/reconciliation and an
explicit go/no-go before migration starts. This is a reservation, **not a
four-hour outage guarantee**. If migration partially commits, there is no safe
automatic down migration or return to pre-PR backend/root PM2. Keep access
fenced until a compatible forward repair or separately approved restore and
older-snapshot reconciliation succeeds. Actual interruption could exceed the
reserved window. No paid-provider test event is required to prove routing.

## Exact order, checks, and phase-specific reversal

1. **Pre-window release and custody.** Approve and merge only the reviewed v2
   activation after its final CI; create the new immutable-by-digest archive
   from the resulting main SHA. Verify GitHub asset and independent build bytes,
   v2 manifest, 161 migrations, exact Twilio hash and four pairs. Create a new
   encrypted owner-only package backup and verify a separate iCloud.com
   download/decryption/read-back. Independently retrieve existing compatible
   JWT/OAuth material; the APP_ENC_KEY and Twilio Auth Token retrieval checks
   already passed. Confirm planned custody for new distinct session and staff
   assertion keys and for the two recovery-login credentials. **Stop** on any
   digest, retrieval or storage mismatch. No target change has occurred yet.
2. **Approve window and observe baseline.** Name the exact start/end and
   incident/alert destination, capture current health/error/latency and job
   cadence, confirm managed PITR status, a usable independent restore
   destination or explicit acceptance of the unmeasured full-restore/RTO risk,
   provider callback retry tolerance, operator SSH and Recovery Console access.
   The hosted restore has passed only bounded read-only checks; no full restore
   or measured RPO/RTO is claimed. **Stop** if the owner cannot tolerate an
   extended outage or any recovery prerequisite is missing.
3. **Fence and quiesce.** Snapshot the existing API firewall/process rules.
   Apply the separately reviewed temporary API TCP 443 deny for Cloudflare
   sources and private operator allow, retaining TCP 80 for the active ACME
   lineage. Confirm public API requests are blocked and the private path works.
   Drain, stop the root PM2 API and all in-process/background writers, and
   verify one cannot continue writing or run another migration. Preserve web
   and permanent firewall rules. **Before SQL starts**, reverse the temporary
   rules and prior process state if this phase fails; after SQL starts, keep
   the fence until compatible recovery is verified.
4. **Capture change-window recovery.** Verify the fresh managed recovery point,
   make a consistent encrypted logical export plus password-free role,
   ownership and grantor metadata, and verify its checksum and private read-back.
   Keep customer rows and credentials out of logs/GitHub. A new managed restore
   cluster is paid and remains unauthorized unless separately approved.
   **Stop** on an unreadable export, missing key, unusable recovery destination
   or unaccepted residual restore risk.
5. **Provision restricted database boundary.** Using a separate privileged
   connection to the manifest-pinned `defaultdb`, run the guarded
   `staff-production-prerequisite-roles.sql`, privately set only the restricted
   `chatforia_dev` password, give the migration executor scoped owner-SET
   authority, then run `staff-access-bootstrap-role.sql` for `staff_security`
   and `pgcrypto`. Run `staff-recovery-operator-logins.sql` only under this
   approval, set two distinct high-entropy credentials privately, store issuer
   in Apple Passwords and executor on sealed paper, retrieve both, and verify
   separate session identities and no cross-role/owner membership. **Stop** on
   unexpected catalog, ownership, provider limitation or privilege. Before
   migration, reverse only newly created objects after dependency review;
   never CASCADE or modify provider-managed roles to force a pass.
6. **Read-only package preflight, then migration.** With strict TLS identity,
   the exact v2 release/checkout, explicit v2 reconciliation ID and private
   receipt archive outside the API host, run `deploy-migration-package.mjs`
   without `--execute`. Require 141 active baseline rows, three inert rolled-back
   records, only the four exact historical ledger/file pairs, 20 pending SQL
   files, and passing role, catalog, data and aggregate predicates. Back up and
   read back its private receipt. Only after a fresh go/no-go, run the **same**
   package with `--execute`; require 161 active rows, unchanged rolled-back
   records, exact new SQL checksums and successful after predicates. Back up
   every attempt receipt, including failed/incomplete ones. **Stop** on any
   fifth mismatch, target/file/ledger drift or failed predicate. Once SQL has
   started, keep fenced and inspect partial DDL/ledger; do not edit checksums,
   mark migrations resolved, apply down SQL or restart the old backend.
7. **Keys and founder bootstrap.** Generate distinct new `SESSION_SECRET` and
   staff assertion keys in protected custody, insert the matching staff key
   version in the protected database row, and retain compatible existing keys.
   Privately reverify the owner-approved immutable founder User ID, verified
   email, enrolled MFA and linked provider. In one locked privileged transaction,
   create the founder singleton, **founder-only** initial authority unless an
   additional exact ID/grant was separately approved, mandatory audit/reason
   and affected session-version increments. **Stop** on identity, singleton,
   key or audit mismatch; transaction rollback before commit, reviewed forward
   correction plus revocation afterward.
8. **Restricted API cutover.** Install the SHA-pinned compatible backend under
   dedicated `chatforia-api` OS identity and systemd, with root-owned 0600 env,
   restricted `chatforia_dev` TLS URL, compatible existing keys, new keys,
   `STAFF_SECURITY_ENABLED=true` and dashboard disabled. Remove old PM2 reboot
   startup and ensure the app/jobs cannot read `doadmin` or root env backups.
   Do **not** dispatch the blocked legacy backend workflow. The already
   deployed staff web UI needs compatibility verification; do not dispatch the
   unpinned-host frontend deploy job merely because main changed. Run runtime
   preflight, one-listener/restart and ordinary job/write/upload checks.
   **Stop** on privileged role leakage, old process revival or failed health;
   keep fenced and use only the compatible recovery artifact/config.
9. **Private smoke, observe, reopen.** Test founder/Support/Admin boundaries,
   password/MFA, pre-MFA denial, permitted audited change, CSRF, logout,
   revocation, ordinary writes/uploads, proxy/cookies and job health using
   private accounts. Verify receipt backup read-back and alert delivery. Reopen
   Cloudflare API HTTPS only after all required checks pass, then watch 5xx,
   latency, authentication/audit failures, callback delivery and scheduled jobs.
   Reapply the fence immediately on a security failure, 5xx above 1%, staff
   API p95 above twice the measured baseline for five minutes, or failed jobs.
   Dashboard and Stage 6 cohort access stay disabled pending a later decision.

## Genuine holds before this can become an executable approval

1. Review and merge the **v2**, not v1, activation branch after disposable
   PostgreSQL 18 CI. Then archive and independently back up the new main SHA.
   The verified v1 backup does not close this hold.
2. Owner supplies an exact off-peak window, maximum tolerated interruption,
   alert destination and callback outage/retry acceptance. If an extended
   outage is unacceptable, stop before migration.
3. Owner chooses an independent restore destination/full restore with separate
   cost approval **or explicitly accepts** that only bounded hosted restore
   readability and managed PITR are proven. Refresh recovery points and export
   at the actual window; no second database on the live cluster is isolated.
4. Privately verify off-host JWT/OAuth retrieval; new session/staff keys and
   recovery credentials are created only during the approved window. Confirm
   the founder-only start or provide exact additional grants. Record private
   alert receipt and incident contact before reopening.

Current local/CI evidence is not a production preflight, migration, restore,
deployment or approval. Repository-wide lint debt and Apple/mobile/Twilio
launch work are separately tracked and do not waive these cutover holds.

## Single approval text to complete after the holds close

> I approve the Stage 5 cutover of the exact reviewed v2 main commit
> `[FULL_MAIN_SHA]`, package SHA-256 `[PACKAGE_SHA256]`, and manifest target/ID,
> during `[START–END, TIME ZONE]`, with `[MAXIMUM TOLERATED INTERRUPTION]` and
> alert/incident destination `[PRIVATE DESTINATION RECORDED]`. I accept the
> documented four historical-SQL uncertainties for **production use** and
> `[APPROVE A SEPARATELY COSTED FULL RESTORE / ACCEPT UNMEASURED FULL-RESTORE
> AND RTO RISK]`. I accept interruption of browser API and provider callbacks
> during the approved fence and the possibility of a longer outage after
> partial migration. I authorize orders 2–9 above only while each exact
> precondition passes, including recovery capture, restricted roles and
> credentials, package preflight and the same-package migration, new session
> and staff keys, founder-only bootstrap, restricted API cutover, private
> verification and controlled reopen. Stop and retain the fence on any listed
> abort condition. This approval does not authorize a different package,
> target, paid resource, unreviewed repair, Stage 6 admission or a legacy
> deployment workflow.

Replace every bracketed field with privately verified values before requesting
this approval. The approval text does not itself perform any action.

Implementation procedures and phase checks are in
[deployment-runbook.md](deployment-runbook.md),
[migration-release-packages.md](migration-release-packages.md),
[ingress-fencing-proposal.md](ingress-fencing-proposal.md), and
[sole-owner-recovery.md](sole-owner-recovery.md). This packet controls the
approval boundary when historical checkpoint text in those files differs.
