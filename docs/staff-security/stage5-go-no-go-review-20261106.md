# Stage 5 GO/NO-GO review — November 6, 2026

**Decision: NO-GO for production execution. GO for review of the prepared
change.** PR #301 is a draft. This record grants no permission to merge, activate
the historical-checksum exception, change production, migrate, restore, or admit
staff. Julian Norton is the named operator and stop authority. A second DBA or
security sign-off is a recommendation, not an existing project requirement;
privileged database execution and the recovery login separation are technical
requirements. The owner accepted sole-person operation for preparation only.

## Evidence already closed

- PRs #293 and #300 are merged. PR #301's reviewed local/CI, synthetic PostgreSQL
  18, Safari/Firefox, and real development Google OAuth → MFA → Support access →
  Admin denial → logout evidence are recorded in the [release plan](release-plan.md).
  These do not represent a production cutover or real-provider staging against
  the future production release.
- Both permanent ingress firewalls and key-only SSH were separately approved,
  applied and verified. Web runner SSH passed in connection-only run #624; its
  deploy job was skipped. The earlier run #623 was a frontend deployment. The
  [ingress record](ingress-fencing-proposal.md) retains the bounded `www` 521
  uncertainty and the still-proposed temporary API migration fence.
- The 141-migration target baseline, four specific historical checksum pairs,
  PostgreSQL 18.6, `doadmin` runtime, absent restricted roles/schema and available
  but uninstalled `pgcrypto` were inspected read-only. Original applied SQL was
  not recovered. The reviewed reconciliation mechanism accepts only the pinned
  target and four pairs; exact matching remains its default. Historical data
  uncertainty was accepted **for preparation only**. The manifest is still
  `proposed-not-authorized-for-production`; no production ledger row was edited.
- A hosted restore passed bounded readability, and the synthetic older-snapshot
  replay/revocation reconciliation passed. The owner-approved founder ID has a
  verified private read-only account record; no ownership row or staff grant was
  inserted. Existing `APP_ENC_KEY` has an exact off-host Mac readback and an
  owner-reported iPhone visual match. Twilio Console's primary Auth Token exactly
  matched its deployed value. Neither value is in this repository.
- The **candidate**, not final activation, package passed checksum verification;
  its encrypted iCloud image passed separate web upload/download, image digest,
  decryption and package readback. See the [package custody procedure](migration-release-packages.md).

## Blocking gates and decisions

| Gate | Current state | Smallest decision/evidence before production |
| --- | --- | --- |
| Four historical hashes | Pinned four-pair reconciliation is proposed; original applied SQL unavailable. | Explicitly accept residual historical-data risk **for production** and approve activation of this exact target/manifest; review/merge the activation change. A fifth mismatch, changed pair, target or file is an abort. No ledger rewrite. |
| Final immutable artifact | Current release and encrypted backup are for the proposed candidate. | Build a new GitHub Release archive from the exact reviewed/merged activation main SHA; verify the digest, all 160 migration files, approved manifest and compatible backend/frontend recovery artifacts. Complete the **final** encrypted backup/cloud readback before any production fence or role change. |
| Change-window recovery | Seven-day managed PITR/new-cluster option and bounded hosted restore readability are known. No fresh window point, logical export, independent restore destination, full hosted integrity or measured RPO/RTO is recorded. | Approve a window/interruption, fresh recoverable point and encrypted logical export with role/ownership metadata. Identify an independent restore destination. Either verify full restore/integrity under separate authorization or explicitly accept the remaining unmeasured restore risk before mutation; a second database on the live cluster is insufficient. |
| Existing/new key custody | `APP_ENC_KEY` and Twilio retrieval are evidenced. JWT/OAuth off-host retrieval is open; production `SESSION_SECRET` and staff assertion key are absent. | Privately verify compatible JWT/OAuth material and recovery access. Approve protected generation/custody of distinct new session and staff signing keys at cutover; keep existing encryption/provider keys unchanged. Never place values in PR or command output. |
| Restricted roles and runtime | `doadmin` still powers the root PM2 API and its jobs. Four prerequisite roles, `staff_security`, and two recovery LOGIN principals are absent. | Approve guarded role/schema/extension provisioning, restricted runtime credential and non-root service cutover. Verify `chatforia_dev` has no ownership, privileged memberships or superuser attributes; migration executor alone gets scoped owner SET authority. |
| Founder/recovery authority | Founder ID approved privately; initial grant/canary list and bootstrap mutation are unapproved. Issuer/executor credential stores selected, credentials not created. | Approve the exact founder bootstrap and initial grants (founder-only is valid), two separate recovery-login creations and secret custody, and distinct-session grant tests. One owner may operate both; this is separation of credentials, not human approvers. |
| Exposure and observation | Permanent firewalls passed; temporary API migration fence, live staff smoke, background-job cadence and alert receipt remain unperformed. | Approve fence, migration/runtime cutover, private smoke, restart/job observation and explicit reopen criteria. Stage 6 named-cohort admission remains a later separate approval. |

The Twilio inbound signature-validation issue is tracked separately as a launch
security fix. Apple server notifications and longstanding repository lint debt
are separate launch/maintenance work; none is evidence that this migration can
run. Do not describe the completed local OAuth test as production-provider
validation.

## Exact production change and approval order

Each numbered action is **pending separate owner authorization**. An approval of
one action does not authorize later actions. Record target, operator, full commit,
package digest, time, result and stop decision in private receipts. Keep secrets,
customer rows and private founder ID out of GitHub.

1. **Activate and release the exception, off production.** Review a narrowly
   scoped change to the manifest status and both digest pins; preserve exact
   checksum validation for all other migrations. Merge only with separate owner
   approval. Create a new immutable migration release from that exact main SHA,
   pin application/recovery artifacts and verify package and SQL digests. **Abort**
   on any target/manifest/SQL drift. **Rollback:** do not deploy or activate; the
   existing proposed manifest and production database remain unchanged.
2. **Back up the final package before the change window.** Put the verified
   activation package/checksum in a new owner-only AES-256 image, verify a local
   read-only mount, upload only image/sidecar to iCloud.com, download a separate
   copy and verify image checksum, decryption and package bytes. The candidate's
   verified backup cannot stand in. **Abort** before any fence, role or schema
   edit if cloud readback fails. Preserve original and returned copies.
3. **Approve and apply the temporary ingress/writer fence.** At the selected
   window, hold operator SSH and recovery access; close direct and proxied API
   mutation/authentication paths while retaining certificate renewal and
   necessary private access; drain and stop API and all background writers.
   **Verify** no conflicting writer or migration process. **Abort/rollback before
   migration:** restore captured ingress/process state only after checking any
   role/schema edits. Once migration starts, retain the fence until compatible
   recovery and smoke pass.
4. **Capture the actual change-window recovery point.** Verify managed backup
   point and independent restore destination; take encrypted consistent logical
   export plus password-free role/ownership/grantor metadata. Record digests and
   key versions privately. **Abort** on unreadable export, missing key, failed
   digest or unacceptable restore risk. A hosted restore to a new cluster would
   require its own approval and any cost approval.
5. **Provision the database privilege boundary.** With a separate privileged
   connection, run the guarded `staff-production-prerequisite-roles.sql` against
   the exact approved `defaultdb`; privately set the `chatforia_dev` credential,
   give only the migration executor scoped owner SET membership, then run
   `staff-access-bootstrap-role.sql` for `staff_security`/`pgcrypto` under the
   reviewed owner. Also run the separate guarded
   `staff-recovery-operator-logins.sql`, privately set two distinct credentials,
   store issuer in Apple Passwords and executor as sealed paper, and prove
   independent retrieval. **Verify** no privileged runtime attribute/ownership,
   no cross-role recovery membership, separate `session_user` logins and expected
   schema/extension ownership. **Abort** on managed-role/extension incompatibility
   or unexpected existing objects. **Rollback before migration:** remove only
   newly created objects after dependency/receipt review; never CASCADE or alter
   provider-managed roles to force a pass. Keep credentials inactive if aborted.
6. **Preflight and execute the exact migration package.** From the pinned
   release, strict TLS and independent private receipt archive, run the package
   runner first without `--execute` using the explicit reconciliation ID and
   pinned target. Inspect all 141 baseline rows, only four approved pairs, 19
   pending files and aggregate/catalog predicates. Back up the actual preflight
   receipt and verify cloud readback before execute. Execute the **same** package
   with separate approval; require 160 completed migrations, exact checksums on
   all newly applied SQL, unchanged user count and successful after predicates.
   Back up the complete execute receipt, including failed/incomplete attempts.
   **Abort** on any wrong target, extra/unfinished migration, fifth mismatch,
   changed ledger/file, failed predicate or receipt failure. **Rollback after
   migration starts:** keep fenced, inspect partial ledger/DDL and repair forward
   with the compatible artifact; do not run down SQL, `migrate resolve`, edit the
   ledger, or revive pre-PR code/root PM2. A database restore is a separately
   approved incident action into an independent target with older-snapshot
   session/grant/replay/audit reconciliation before reopening.
7. **Provision keys and bootstrap founder atomically.** Create distinct
   `SESSION_SECRET` and staff signing key through protected custody; insert the
   same staff key bytes/version into the protected assertion-secret row. Preserve
   compatible `APP_ENC_KEY`, JWT and OAuth material. In a reviewed privileged
   transaction, lock the privately approved immutable User row, verify its
   verified-email/MFA/provider state and absent founder singleton, insert only
   the approved founder reference and initial assignments, append required
   event/reason/audit and increment affected session versions. Start founder-only
   if no other ID/grant is approved. **Abort** on identity mismatch, conflicting
   singleton, missing audit or secret mismatch. **Rollback:** transaction rollback
   before commit; after commit retain audit and fence, correct forward through a
   separately reviewed action with session revocation.
8. **Cut over API and verify while fenced.** Install the SHA-pinned compatible
   backend under a dedicated `chatforia-api` OS user/systemd unit with root-owned
   0600 `/etc/chatforia/api-runtime.env`, restricted `chatforia_dev` URL/TLS,
   existing compatible keys and `STAFF_SECURITY_ENABLED=true`, dashboard=false.
   Disable old root PM2 startup and prevent app/job access to `doadmin` env or
   dumps. Run runtime preflight, one-listener/process-restart checks, jobs under
   the restricted role, private MFA/authorization/revocation/audit/CSRF/logout
   and ordinary write/upload smoke, and matching web/proxy checks. **Abort** on
   any privilege leak, old process revival, missing audit, denied legitimate
   flow, unauthorized access, failed job, TLS failure, 5xx above 1% or staff API
   p95 above 2x measured baseline for five minutes. **Rollback:** retain fence;
   use the compatible recovery backend/config and forward repair. Do not restart
   pre-PR backend or turn off staff security.
9. **Reopen only after verified receipts and observation.** Verify receipt backup
   readback, alert delivery, a successful restricted-role restart and normal
   hourly/daily job cadence. Reopen the approved API paths in a controlled order
   while dashboard remains off. Stage 6 founder/named-cohort admission and any
   broader rollout require a separate decision. On a failure, reapply the fence,
   preserve receipts/logs, investigate and use the phase-specific rollback above.

## Present decision requested from owner

The next smallest decision is whether to **approve the target-bound four-pair
exception for production preparation**, accepting the documented historical-data
uncertainty, so its activation change can be reviewed. That alone would not
authorize a merge or any production action. Before scheduling execution, the
owner must also choose the window/acceptable interruption, initial founder-only
or exact additional grants, a private alert destination, independent restore
destination and full-restore test versus explicit residual-risk acceptance, and
approve each numbered production change. The final package backup/cloud readback
will occur **after** the activation commit is reviewed/merged and archived, but
**before** any production fence, role creation or migration. Actual preflight and
execution receipts will be encrypted and read back separately after each attempt.
