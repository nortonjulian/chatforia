# Stage 5 managed PostgreSQL role self-grant correction — preparation only

Fixed release before this correction: `49b099e2eef836eb23b7245768cf633b28fd70a9`.
Production remains online on the existing API process; the firewall is
unchanged. This document does not authorize another production attempt.

## Cause and observed permission effect

The November 9 read-only query on `defaultdb` reported PostgreSQL 18.6
`createrole_self_grant = inherit,set`, source `configuration file`, context
`user`. After the prior base-role transaction, each new role had its expected
bootstrap-superuser-granted ADMIN edge to `doadmin`, plus a second
`doadmin`-granted `SET TRUE, INHERIT TRUE, ADMIN FALSE` edge. The latter allowed
the privileged creator to set and inherit the new role. This matches
[PostgreSQL 18's documented setting](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT).
It does not mean the restricted runtime role could set or inherit staff roles.
The creator's ADMIN edge already permits it to grant itself access later, so
`doadmin` must remain outside the runtime security boundary.

A disposable, networkless PostgreSQL 18.6 container with a non-superuser
`CREATEROLE` account and `createrole_self_grant=inherit,set` reproduced the
exact two edges, successful `SET ROLE`, and inherited role access. This is an
isolated behavioral reproduction; it is not a production write test.

## Smallest correction

The base-role and recovery-login SQL scripts each set
`createrole_self_grant` to empty **only inside their own transaction**, before
creating roles. Both verify the local value. The base-role script now verifies
the four restricted role flags and the complete membership graph before
commit: only four bootstrap-superuser ADMIN edges, with `SET FALSE` and
`INHERIT FALSE`, for a non-superuser creator. The recovery-login script also
checks that its two new login roles have only their expected creator ADMIN
edges, besides the existing exclusive issuer/executor SET grants. Any extra
grant aborts the transaction; no server, database, or persistent role setting
is changed. The originally reviewed scoped `SET` grant to the staff schema
owner remains a separate, explicit DBA transaction.

The isolated test passed under the managed-style setting. It also verified
that omitting the local override aborts without creating roles, an injected
extra base or login membership rolls back the transaction, the setting returns
to `inherit,set` in the next session, and runtime/cross-recovery role changes
remain denied. The test intentionally uses no production URL or credentials.

## Release and backup impact

This changes two release SQL scripts and the PostgreSQL 18 CI regression; it
does not edit any of the 161 migration SQL files, the four-pair exception
manifest, or locked dependencies. The existing `49b099e2` archive and its
verified encrypted backup remain valid records of that **old** release, but
cannot be used as the corrected cutover package. After code review and merge,
fix a new main SHA, archive it, verify all packaged hashes and 161 migrations,
rebuild the upload-free source tar, and create and independently read back a
new encrypted release backup. The dependency artifact may be reused only
after lockfile, Node/native target and its pinned hash are reverified. Keep
the old backup. The inactive production stage is not to be activated or
rewritten under this preparation approval.

## Next bounded production request, after a new release and backup

1. Confirm the exact new release/archive/source/dependency/backup hashes,
   target `defaultdb`, PostgreSQL version, `createrole_self_grant` value and
   source, unchanged migration ledger, absent staff roles/schema and current
   API health. Stop if any baseline differs.
2. Transfer only the newly pinned, upload-free source archive to an inactive
   stage, reuse the dependency artifact only if its compatibility pins match,
   and repeat the focused synthetic native/Prisma/unit checks. Keep writers,
   PM2 and firewall unchanged.
3. Run only the corrected, SHA-pinned base-role transaction as `doadmin`.
   Immediately verify four restricted roles, null initial passwords and the
   exact four creator ADMIN edges. Stop and use the reviewed dependency-checked
   cleanup if any edge or role flag differs.
4. In the reviewed scoped transaction, grant the staff owner `SET` authority
   to the DBA and create the empty staff schema; verify ownership and ACLs.
   Run the corrected recovery-login transaction and verify exact issuer and
   executor grants, with no additional self-grants or cross-role access.
5. Provision three distinct credentials privately and verify separate allowed
   and denied logins through the isolated tunnel. Prepare off-host signing
   keys only. Run the read-only target-bound preflight once its schema
   prerequisites exist. Record nonsecret before/after receipts and API health.

**Stop and cleanup:** Any unexpected role edge, setting, ownership, ACL,
credential test, hash, ledger or API-health result stops preparation. Roll
back the current transaction. Disable any committed new login with `NOLOGIN
PASSWORD NULL`; drop only objects proven unused by catalog dependency review,
using individual drops without `CASCADE`. If safe cleanup cannot be proven,
leave new roles dormant and report their exact metadata. Never change
provider roles, migration records, live API environment or firewall.

**Approval boundary:** A new bounded online-preparation approval is required
after the corrected release and backup are reviewed. Maintenance-window
approval follows only after that preparation passes. No migration SQL,
founder activation, API switch, firewall change, restore or Stage 6 is
authorized by this plan.
