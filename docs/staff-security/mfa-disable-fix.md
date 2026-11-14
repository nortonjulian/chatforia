# Former staff MFA disable

A valid TOTP submitted by a former staff account reached the direct User update,
where the protected-identity trigger raised SQLSTATE 42501. The API returned 500.

The restricted-runtime disable route now verifies TOTP under the user lock and
calls a domain-separated, signed, short-lived database operation. The operation
checks current account state, token version and encrypted-secret digest; rejects
active staff, global ADMIN and any FounderOwnership identity; and atomically
records an audit nonce, clears MFA/recovery codes, consumes pending MFA tokens and
increments tokenVersion. StaffAssignment and staff history are never changed.
Direct credential writes remain prohibited for historical staff identities.
The advisory lock precedes the user lock, matching delegation and recovery.

The website already displays the API's error field; the new 403 response provides
an explicit policy explanation. Eligibility is determined from live database rows,
not from a screenshot, username, or user ID hardcoded into the change.

## Verification

- Server enrollment and route suites: 14 tests passed.
- Client two-factor API and settings component suites: 23 tests passed.
- Disposable PostgreSQL 18.6 regression: real identity/token triggers and runtime
  role; ordinary/former-staff success; founder/active/admin denial; direct update
  denial; forged/expired/stale/secret-mismatch/null-nonce/replayed assertions;
  cleanup with literal MFA prefix; retained staff row; audit failure rollback;
  concurrent staff grant waits on the shared lock and prevents disable.
- ESLint: no errors; existing route/test import warnings remain.

The database regression uses a synthetic schema, not a full production restore.
Run with the `pg` Node package available (via NODE_PATH if installed separately):

```sh
MFA_TEST_ADMIN_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/postgres \
  node server/security/db-qa/mfa-disable.mjs
```

It creates/drops a randomly named disposable database; use an isolated local
cluster. It provisions the two NOLOGIN fixture roles if missing.

## Release boundary

No production changes were made. Migration
`20261114050000_authorized_mfa_disable` must be applied through the approved
migration role before activating the patched API with STAFF_SECURITY_ENABLED=true.
Use the existing release verification and controlled deployment process. Verify
the actual account's FounderOwnership and active staff status at rollout; this
checkout cannot establish private production ownership records.

This change is limited to disable. Historical staff protection on other credential
operations, including subsequent MFA enrollment, is unchanged; it does not return
a former staff identity to unrestricted credential management. A general credential
transition/re-enrollment workflow requires separate coverage.
