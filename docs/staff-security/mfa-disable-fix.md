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

- Server enrollment and route suites: 16 tests passed.
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

The change also supports re-enrollment for eligible ordinary/former staff accounts.
The setup/enable operation uses a separate signature domain and immutable audit
nonces. It cannot replace an enabled secret. Enable binds the pending record to the
user, current token version, encrypted-secret digest and expiry, after application
TOTP verification. Recovery hashes must be ten distinct SHA-256 values. Replacing
setup consumes previous pending records; enable rotates the session version and
returns fresh recovery codes. Active staff/founder/admin recovery remains separate.
Other protected credential operations are unchanged.

The v4 manifest pins the exact proposed 164-to-165 transition and remains explicitly
unapproved for production. The previously approved v3 manifest is unchanged.
CI checks both release transitions, schema/function permissions and the full
former-staff disable/re-enroll cycle, including expired/replaced/cross-account
pending denial and enabled-secret replacement denial.
