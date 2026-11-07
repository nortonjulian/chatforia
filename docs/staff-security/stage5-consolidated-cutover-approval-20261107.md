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
  historical evidence; **do not execute it against the current code**. Its 161
  migration SQL files and other shared packaged files match the v2 candidate.
  It instead embeds the in-place v1 manifest, which the current checker rejects
  as `Unreviewed reconciliation manifest`. Using it would require the exact
  older `026b1c92` runner/checkout and would omit the later v2 checks.
- [Main PR #307](https://github.com/nortonjulian/chatforia/pull/307) restored
  archived v1's exact 160-migration proposed manifest (SHA-256
  `a59c5f947c0d2059c98f67e85230b74d6ceccfbc9d778e44278680983e2630e5`)
  and introduced a distinct 161-migration v2 manifest. V2 remains proposed
  on main (SHA-256 `0b49aab2bc1be3a3d230c1f6d2fc1c8368e8e4639860d12ea1fc76a925e2e7f0`).
  The review-only v2 activation branch
  proposes the status change, pins resulting SHA-256
  `9d804646458a74c8fa3934db379d0431d166a26aa7104c58d1b42287ffa6c187`
  independently in the request gate and package checker, and exercises the
  activated path in disposable PostgreSQL 18. V1 bytes, migration SQL, ledger
  records, four reviewed historical pairs, target and evidence are unchanged.
  PR #306's prior in-place V1 approval remains in Git history at `026b1c92`;
  it does not authorize V2.
- The earlier 168-file/160-migration candidate and its verified encrypted
  iCloud readback also remain historical evidence. Preserve both that candidate
  and the later `026b1c92` archive/image; neither is the final v2 package.
- No final v2 archive or cloud backup exists. A deterministic package from
  reviewed code commit `b3f402ce65187fff7a4f93a5792fe04d80c1424a`
  (169 files, 161 migration SQL files) has SHA-256
  `58ef7ea07792df11c5fab55d5355d03f057d0b2ddb5b6b9c965bc10137d6f275`.
  This is a **local candidate**, not the final package. Main's active ruleset
  requires linear history, so a merge commit cannot preserve the PR head on
  main. After a separate merge approval, use the allowed squash method and
  record the resulting main SHA. The manual archive workflow must package
  **that main SHA**, producing a new commit-bound digest. Independently compare
  its 161 SQL files, exact 160-file legacy set, Twilio checksum, four pairs,
  three inert rollback records, v2 ID/status and all packaged file hashes
  against the reviewed source candidate; review any difference before proceeding.
  Verify the new archive asset checksum and an independent build. Encrypt and
  independently read back the new package before any production fence, role
  change, preflight or migration. Never relabel the `026b1c92` archive or
  reuse its digest. A changed code-bearing PR head or main base requires fresh
  review and applicable CI before merge.

## Exact v2 exception and release set under review

V2 ID: `chatforia-defaultdb-four-hash-consent-20261106-v2`. Its sole target is
`chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb`.
The release pins the first 160 migration names and SQL hashes as set digest
`ad8b4728d73fffedd8f2f13f20ac587f27c417a086fe7f28aeee2ef939ab382c`,
plus `20261106010000_twilio_compliance_event_sid` with SQL SHA-256
`3befceaba8f76df39c15a60cadcd8698f06c03ceee71c263210c62bff6dde78a`.
The expected target ledger is 141 active baseline migrations and exactly three
unfinished historical rolled-back attempts before execution, with 20 pending
SQL files; afterward it must contain 161 finished active migrations and the
same three rolled-back records. Their actual IDs/checksums are checked in the
private target ledger and retained unchanged in receipts; the manifest does
not enumerate those row identities.

Only these four recorded/available SQL checksum pairs may differ:

| Migration | Target recorded checksum | Available SQL checksum |
| --- | --- | --- |
| `20260726034500_add_wireless_refund_audit` | `63434b2fb65211b9d6e4be08352ac66db4c7e209d1e20b67006022ba36d34767` | `f20ce82990bc7627a5f1d485b0f43a4e36ebf81bba3e35482d086ba7166533ca` |
| `20260806030000_add_pstn_reporting_and_blocking` | `94fe6d123994ae57dffeca09dfa26539b3174725bad2ae3fd9efabcbd785785b` | `19a1a154ba49a030dbe3aa4116c692b563e630ff6029656c5372a0d691a81cf1` |
| `20260807010000_add_sandbox_apns_tokens` | `164917910396613ca5934d542d661268ba88d506dddf3d9ad73965417a418ab7` | `d2a68cbfbc475480b14b40d91ff1e591990e2ac144910cc8080689e9f609f271` |
| `20261013_add_esim_replacement_audit` | `3e95935c4c4646839fc532a7fd7f6565688fd1e52700612994494f3f5f79e3b3` | `b2d299423e802dfb50958caa92c71813702c210df1ef7c84f039d3e22a1a39f4` |

The original applied SQL for these four migrations remains unavailable.
The 215-object synthetic PostgreSQL 18 catalog reconstruction and bounded
current-data predicates do not prove every historical data effect. The owner
accepted that uncertainty for preparation only. A fifth mismatch, altered
target, evidence, SQL, rollback history or other ledger entry is an abort.
Without the explicit V2 ID, strict checksum validation remains the default.
The activation branch's [PostgreSQL 18 and app CI](https://github.com/nortonjulian/chatforia/actions/runs/42341032152)
and [append-only CI](https://github.com/nortonjulian/chatforia/actions/runs/42341032100)
passed after the v2 status/pin change. A later documentation-only receipt update
does not change those tested code bytes.

## Separate decisions and the next approval

The next owner decision is whether to accept the four specified historical
checksum exceptions and unavailable-original-SQL uncertainty **for the v2
source gate**, and approve a squash merge of PR #308 after final review and
passing required CI. The merge makes the exact v2 manifest status
`approved-for-production` in source code, but it does **not** authorize anyone
to invoke that gate against the production database. The owner may decline
either part; no production command follows from this approval. The reviewed
candidate digest is not the post-merge release digest.

Proposed next approval, limited to source review and merge:

> I accept the documented uncertainty from the four exact historical checksum
> pairs and unavailable original SQL for the v2 reconciliation source gate,
> and approve squash merging PR #308 after its final diff and required checks
> pass. This does not approve a production preflight, migration, role or key
> change, deployment, or cutover. I will review the new main commit and final
> release package separately before any production execution decision.

The manual archive and independent package verification follow a separately
approved merge. A new encrypted backup and independent cloud read-back need
owner custody action. Only then can the exact final package SHA and release
commit be put into the later production approval. Local CI, package review,
and old-backup custody are reusable evidence; none substitutes for a fresh
target preflight or change-window recovery point.

## One proposed production decision, only after the holds below close

The pending decision is whether to accept the residual historical-SQL risk
for **this exact V2 ID, target, four pairs and 161-migration set**, then approve
one bounded cutover window covering orders 2–9 below using the final reviewed
package. It is not requested by this coordination update: the final package
SHA and other hold fields do not yet exist. Separate review and merge of the
V2 activation branch precede this production decision.
When those holds close, the owner may approve that bounded window,
with a stop after every order. Approval of this packet would not authorize
Stage 6 admission, a paid restore cluster, a different SQL/package/target,
unreviewed repair, or reusing the old privileged runtime. Record the exact
window, maximum acceptable interruption, current-main/release SHA and digest,
private founder ID, alert destination and recovery-risk choice in the private
execution record before requesting that approval. An approval with any field
missing is not executable.
The historical-SQL risk acceptance belongs in this one later cutover decision;
the review-only V2 source status and earlier V1 approval are not substitutes.

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
   never CASCADE or modify provider-managed roles to force a pass. The restricted
   runtime must have `USAGE` on `public`, `SELECT, INSERT, UPDATE, DELETE`
   on `SmsCarrierEvent` and `SmsOptOut`, and `USAGE, SELECT` on their ID
   sequences, without table ownership or privileged membership. Verify these
   rights under `chatforia_dev`; the Twilio migration does not grant them.
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
   mark migrations resolved, apply down SQL or restart the old backend. The
   consent migration must complete before starting the compatible API code.
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
   Signed voice/SMS/MMS/regulatory callbacks require the separate real-provider
   verification after deployment; synthetic CI is not that evidence. Porting
   remains inactive.

## Genuine holds before this can become an executable approval

1. Separately approve and squash merge the **v2**, not v1, activation branch
   after final review and disposable PostgreSQL 18 CI. Archive the resulting
   main SHA, review its new package digest and file hashes against the candidate,
   then independently back up and read back that new archive.
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
> `[FULL_MAIN_SHA]`, package SHA-256 `[PACKAGE_SHA256]`, manifest ID
> `chatforia-defaultdb-four-hash-consent-20261106-v2`, and target
> `chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb`,
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
