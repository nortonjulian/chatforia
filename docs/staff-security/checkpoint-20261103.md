# PR #293 checkpoint — 2026-11-03

PR remains draft; release remains HOLD. No merge, deployment, production access,
existing-database migration or spending is authorized.

## Completed real Google web OAuth follow-up

The real Google web callback → Chatforia MFA → SUPPORT access flow passed in a
human browser against fresh isolated local PostgreSQL/Redis. The local observer
independently records pre-MFA denial, post-MFA SUPPORT 200, ADMIN 403 and observed
logout followed by staff/admin/session 401. The successful browser MFA request
also has redacted pending-cookie/CSRF validation evidence. See
[verified Google rehearsal and development CORS fix](google-oauth-local.md) and
[sanitized evidence](evidence/google-oauth-local-20261103.json).
This is real Google web verification, not mocked OAuth; it is not Apple/mobile,
hosted HTTPS/proxy or DigitalOcean managed-service verification.

## Completed work and evidence

- Protected authorization, MFA/credential recovery, session revocation, signed
  single-use writes, audit atomicity and restricted runtime/owner/operator roles
  remain enforced. Four security SQL migration hashes are unchanged.
- Users View/Edit and branded Admin/Staff dashboard polish are complete. List and
  detail APIs share the exact edit-eligibility predicate. The list returns only
  safe fields plus `editableFields`, without leaking protection records or secrets.
  Protected/current/former staff/founder/admin/system/test/deleted identities have
  no editable fields. Missing permission metadata also disables Edit immediately.
  Details and writes still recheck current server authority; listing metadata
  grants no write access. No role-based protection inference is used in the UI.
- Prior local evidence: 271 staff/API tests; 23 affected UI component tests;
  10 real full-shell Chrome checks; five dashboard browser groups at desktop/narrow
  widths plus the final table-sizing check; helper freshness/MFA/replay regression
  checks. Focus trapping/restoration, reasons, conflict detection and auditing
  remain intact. These completed checks were not broadly repeated for this fix.
- Synthetic backup/restore and restored MFA/token writes passed. Older-snapshot
  recovery passes 10 checks through signed security-state reconciliation, replay/
  audit preservation, revoked-credential denial and legitimate recovered access.
  All database evidence used fresh isolated local/CI PostgreSQL, not DigitalOcean.
- Final targeted checks pass: **26/26** Users detail/list API tests and **8/8**
  mounted Users page tests, plus scoped lint and the unchanged migration verifier.
  They cover the shared protection predicate, safe projection and immediate/
  fail-closed Edit states. Final pushed-head CI
  result and exact commit are recorded on PR #293; do not infer success before CI.

## Safari and Firefox — user-reported passes

The owner reported these passes for **both Safari and Firefox** on 2026-11-03:

1. Administrator password login and MFA.
2. Users View.
3. Edit Cancel.
4. Save with a required change reason.
5. Saved values persist after reload.
6. Logout followed by Back/reload denies restored access.

These are user-reported hands-on results, not independently observed automation.
Browser/OS version details were not supplied. Do not extend this evidence to
screen readers, real mobile devices, OAuth, provider hosting, SUPPORT-only edges,
or every Safari/Firefox failure mode. Those earlier generic browser-pending notes
are superseded for the six explicitly reported administrator flows only.

## Genuine outstanding release checks

- **Independent security/DB review and lint ownership:** root repository lint still
  has the documented baseline 384 errors / 2,609 warnings; prior comparison found
  zero introduced findings, and scoped staff lint passes. No rules were weakened.
- **Real providers and human recovery:** actual Apple sign-in and any provider/mobile/device flows outside the completed
  Google web flow; independently controlled recovery identities and the actual
  secret store/approval process, including authoritative fenced post-backup
  security history. Offline OAuth mocks are not provider verification.
- **Isolated hosted/provider staging:** DigitalOcean managed role/pgcrypto/ownership
  and TLS/firewall compatibility; managed backup/PITR and measured RPO/RTO;
  deployed HTTPS/cookie/domain/proxy/CORS/CSRF, jobs/egress, alert delivery,
  compatible rollback and staffed canary/stop criteria. Local PostgreSQL and local
  HTTP do not close these gates. No safe existing sandbox is verified; a logical
  database on the production cluster is not isolation. No paid sandbox authorized.
- **Remaining device/accessibility sign-off:** real mobile devices/screen readers
  and any supported-browser edges outside the reported admin flows.

Before production, separately authorize the target and operators, verify the four
migration hashes and least-privilege prerequisites, prove a recoverable compatible
backup/restore, fence traffic/writes for migration and recovery, and retain keys,
audit/replay state and compatible application rollback. No down migration or older
snapshot may reopen access without signed security-state reconciliation. See
`release-plan.md`, `older-snapshot-recovery.md` and the zero-cost `staging-proposal.md`.
