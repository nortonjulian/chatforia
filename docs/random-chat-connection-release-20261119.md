# Random Chat connection migration proposal

This is a **proposed, not authorized for production** successor to the approved
166-migration v5 release. It adds only
`20261119010000_random_chat_connection_grace`; v5 and all previously approved
SQL remain unchanged. Merge, production preflight, migration execution, API
deployment, and client releases require separate decisions.

## Review boundary

- The SQL creates `RandomChatConnection` with foreign keys to existing rooms
  and users, an active-user uniqueness index, and no update or deletion of
  existing rows. Existing rooms and messages remain readable. Active matches
  created before this table exists have no connection rows and cannot be
  restored after API cutover; drain them before deployment.
- The restricted API role gets `SELECT`, `INSERT`, and `UPDATE` only on the
  five lifecycle fields. It gets no `DELETE` or ownership-key updates. The
  table has no sequence. Runtime preflight checks these exact capabilities.
- `deployment-checks.json` requires unchanged `User` and `RandomChatRoom`
  counts and verifies the new table is absent before and present after. The
  disposable PostgreSQL rehearsal also preserves an existing room and message,
  tests runtime lifecycle writes, and rejects runtime deletion.
- The v6 manifest pins the approved v5 manifest digest, 166-file base digest,
  exact new SQL digest, 167-file resulting digest, target, and historical
  ledger shape. Package construction rejects missing, extra, or changed SQL.

The manifest status remains `proposed-not-authorized-for-production`. The
package runner and production preflight must reject execution until an owner
separately approves an exact reviewed status revision. Do not edit v5, weaken
its checks, use a direct Prisma deploy, or alter `_prisma_migrations`.

After source-gate approval and merge, follow the existing migration package
runbook: build a new archive from the exact approved main commit, independently
verify its digest and SQL, perform target-bound read-only preflight and backup,
then request separate execution and API deployment approvals.
