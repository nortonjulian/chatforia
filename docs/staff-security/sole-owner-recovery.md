# Sole-owner protected-credential recovery — prepared, inactive

The owner accepted the residual risk of operating both recovery steps as one
person on November 6, 2026. This is **separation of credentials and sessions,
not two-person approval**. Do not describe two accounts controlled by the owner
as independent humans or imply that the database proves who operated them.

## What the implementation enforces

The protected-recovery migration creates separate restricted NOLOGIN issuer and
executor roles. An issuer may insert only the permitted approval columns; the
database writes `approved_by` from `session_user`. An executor can call the
recovery function but cannot insert an approval. The function rejects an approval
whose issuer `session_user` equals the executor `session_user`. It binds a fresh
token to one target, action, exact replacement-value hash and expiry of at most
ten minutes, consumes it once, writes a mandatory audit event and increments the
target user's `tokenVersion` in the same transaction. Protected access still
requires MFA. Rollback on audit failure, replay denial and old-session denial
have isolated synthetic coverage.

The database establishes distinct login identities, **not independent human
review**. A compromised owner or both stolen credentials can complete both
steps. A privileged DBA can bypass these role boundaries. This residual risk is
accepted for preparation only; no recovery login or production use is authorized
by this document.

## Prepared role boundary

The [guarded login template](../../server/scripts/staff-recovery-operator-logins.sql)
creates `chatforia_recovery_issuer_login` and
`chatforia_recovery_executor_login` with `PASSWORD NULL`, no inheritance or
administrative attributes. Each may SET only its matching NOLOGIN role. The
template rejects an unexpected target, prior logins, unsafe base roles and
cross-role/owner membership. It is **not** the existing-database QA fixture and
must not run without a separately approved DBA change. The PostgreSQL 18 CI
rehearsal checks the role graph, missing passwords, simulated distinct session identities,
cross-role denial and repeated-run rejection on a disposable instance.

Before production activation, a privileged operator must inspect the entire
membership graph and effective grants, including PUBLIC database/schema grants,
confirm that the application runtime and background jobs have neither recovery
login nor membership, and provision two different high-entropy passwords through
private input. Store them in **separate, independently retrievable owner-controlled
credential stores** off the API host and outside GitHub. Verify retrieval of each
without printing values or hashes. The two active sessions must authenticate
separately as their own LOGIN roles; `SET ROLE` within a single DBA session does
not satisfy the `session_user` separation test. Restrict network access and
credential exposure as far as the managed database permits. Stop if a login can
SET the other's role, act as security owner, or inherit broad object privileges.

## Use and evidence for a future approved recovery

1. Verify the target owner's identity through a separate trusted channel or
   device. Record incident reference, target immutable ID, action and reason in
   private custody. Sole ownership means this check is self-attested, not an
   independent approval.
2. Open a fresh issuer login session. Generate a fresh token privately and insert
   only its SHA-256, the exact target/action, replacement-value SHA-256 and a
   deadline within ten minutes. Never put token, replacement value or passwords
   in a command line, ticket, log or repository file. End that session.
3. Open a separate executor login session and call the parameterized recovery
   function with the exact token, target, action, value and nonempty reason.
   Stop on expired/replayed/retargeted approval or any audit failure. End the
   session; do not reuse the approval.
4. Verify the mandatory audit row, consumed approval, incremented token version,
   revoked old sessions/challenges/reset links and successful fresh MFA for the
   legitimate owner before reopening access. Preserve private receipt IDs and
   timestamps; do not publish personal data or credentials.
5. Revoke active sessions and rotate both recovery passwords after use or
   suspected exposure. Preserve the audit and approval history. Review credential
   store recovery after a lost-device scenario. A failed identity, custody,
   session or audit check means recovery access stays closed.

Production role creation, password provisioning, founder bootstrap, migration,
exception activation and credential recovery each require their own explicit
execution approval. The founder's exact User ID remains in owner-only private
evidence; its read-only verification and owner acceptance did not grant a role.
