# Older-snapshot reconciliation and controlled local reopening

## Scope and result

`node server/scripts/staff-older-snapshot-qa.mjs` runs this scenario only in two
new, private, synthetic local PostgreSQL clusters. It accepts no existing URL,
archive or directory. The restored application's HTTP listener is loopback-only
and starts only after reconciliation and credential gates. This is an executable
local regression and an incident-design reference, not a production recovery CLI,
managed-service certification, deployment or authorization to restore a live DB.

QA/CI commit `5b4205c0` implements the expanded scenario, which passes ten checks. It proves the older snapshot can revive
sessions/grants and lose consumed assertions, approvals and newer audits, then
proves reconciliation, independent credential recovery and controlled local access.
The real HTTP app uses synthetic credentials, test Redis, dummy provider config
and no developer dotenv file; hosted TLS/OAuth/secret-store checks remain pending.

## Prerequisites before a real recovery could reopen access

A backup is not the authority for security changes committed after its time point.
Require an authenticated, complete post-backup security record through an agreed
cutover watermark, tied to the exact source identity, backup digest and reviewed
schema/migration identity. Its trust key and custody must be independent of the
restored database/backup. A signature proves origin/integrity, not completeness:
source writers, jobs and authentication issuers must actually be fenced, and the
incident owner must establish that the journal/export covers every relevant
security change before certifying completeness.

The local fixture provides that prerequisite by controlling all source writers,
capturing one repeatable-read export after the post-backup changes, stopping the
source cluster and signing the export with a separate process-only key. Dataset
coverage includes staff events, ordinary audits, recovery events, consumed staff
assertions, MFA assertion nonces, recovery approvals, current staff assignments
and user token-version floors. Source/backup/schema identities and watermark are
validated before writes. An absent, partial, wrong-source or unauthenticated export
must keep traffic closed; do not infer revocation state from the old snapshot.

If the original service and any authoritative external post-backup record are both
unavailable, the exact missing prerequisite is that complete trusted security
history. This rehearsal does not reconstruct missing facts from nothing. A real
incident then requires a separately approved account-wide recovery/quarantine
policy and evidence-retention decision; it cannot use this success as permission
to reopen with snapshot credentials or grants.

## Reconciliation sequence and verified invariants

1. **Keep traffic fenced.** Stop/drain all app instances, authentication issuers,
   background jobs and operator mutations at the agreed cutover. Preserve the
   source evidence read-only. Restore only to the approved independent target.
   Never route traffic merely because schema/readiness checks pass.
2. **Contain stale authority.** Rotate JWT and staff-assertion keys, provision the
   matching DB verification key, increment session versions, revoke restored
   staff assignments and expire restored approvals. Keep the existing MFA
   encryption key available until approved credential recovery replaces secrets.
   Key rotation alone does not repair grants, passwords, backup codes or audit loss.
3. **Validate evidence and reconcile atomically.** Verify the signed source,
   backup/schema digests, cutover and required datasets. Import current authority
   only from that evidence. Apply token-version floors above BOTH restored and
   source values; never decrease them. Preserve all revocations and reject any
   extra active grant. Missing identities or unexplained immutable conflicts are
   blockers, not invitations to guess or overwrite records.
4. **Preserve audit lineage.** Keep existing target/containment audits. When an
   audit sequence ID collides with a newer source event, append the source event
   under a new target ID and record the source ID, source identity and complete
   signed payload/digest in a private reconciliation ledger. Do not update/delete
   either historical event. Preserve staff/recovery events and advance sequences
   so later writes cannot collide. Sequence gaps after rollback are acceptable;
   loss of event payload or provenance is not.
5. **Merge replay state conservatively.** Preserve consumed staff assertion IDs
   and MFA nonces. Retain target-side consumption; reject conflicting assertion
   identity/action/target data. Restored approvals remain expired, with source
   consumption retained; importing history must never make an approval actionable.
   A replay resigned with a current key and current actor session must still fail
   for a consumed assertion ID. The fixture specifically verifies this case.
6. **Commit only with mandatory audit.** Reconciliation records and state changes
   commit with a reconciliation audit and completed batch marker. A real DB
   not-null failure in that final audit rolls back imported rows, authority,
   session floors and ledger state. Retrying an already completed batch must not
   duplicate events or restore older authority. The local fixture-only ledger is
   not an application migration or permission grant.
7. **Reverify affected credentials.** Do not mistake a revoked JWT for a revoked
   password/TOTP/backup code. Reconcile trustworthy latest credential state or
   require fresh independent recovery for every affected/uncertain identity.
   The fixture takes the conservative option: fresh PASSWORD and MFA_REPLACE
   approvals for all protected accounts, including the founder. Issuer and
   executor use distinct database session identities. Each approval is bound to
   the target, action and exact replacement hash, consumed atomically and audited.
   New MFA replaces old enrollment and deletes old backup codes; outstanding
   challenges/reset tokens are invalidated. No runtime receives operator/owner
   membership. Actual human identity verification remains a separate obligation.
8. **Evaluate the reopening gate against actual state.** A completed ledger
   alone is insufficient. Verify every imported event/replay/approval payload in
   the database, audit mappings, exact permitted active profiles, version floors,
   expired/consumed approvals, fresh independent recovery audits, removed backup
   codes/challenges, key match and runtime readiness. Missing replay/approval
   rows, altered audit payloads or an extra active grant must block access.
9. **Open only the approved boundary.** The fixture writes an authenticated gate
   for `synthetic-loopback-only`, appends a local reopening audit, then starts a
   loopback HTTP probe. Old snapshot/post-backup passwords, old TOTP, old backup
   codes and old sessions fail. The recovered ACCESS_ADMIN must complete new MFA,
   can read staff assignments and cannot read Users/admin APIs. The revoked user
   cannot access staff even with a current MFA-verified ordinary session. This is
   not approval for public traffic or production reopening.

## Regression evidence and remaining limits

Tests include tampered signature/payload, incomplete source attestation, missing
batch, actual mandatory-audit SQL failure with full row/authority/version rollback,
idempotent imports, audit sequence collision provenance, deleted replay/approval
rows, extra active grants, altered audit status, partial credential recovery,
founder recovery omission and newly signed consumed-assertion replay. Legitimate
recovered password/MFA and denied old credentials are tested through the real app.

Machine summary: `/tmp/chatforia-staff-older-snapshot-report.json`; its private
artifact directory contains the synthetic dump, signed source export, local gate
and HTTP diagnostics. The HMAC trust keys are process-only, not published or
recoverable from the report. Both clusters stop after the probe. No production
access, paid resource or existing-database migration is involved.

DigitalOcean managed role/extension permissions, provider backup/PITR consistency,
actual secret-store custody, real human verification and live ingress fencing
remain unverified. They require separately authorized, genuinely isolated provider
resources/access; spending and production access remain prohibited. Do not reuse
production chatforia-db, even through another logical database, for this exercise.
