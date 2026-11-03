# Isolated DigitalOcean staging proposal — not authorized

Approval would cover only the new resources below and one reviewed PR revision.
It would not cover a merge, production deployment, production resource access,
production data copy, or migrations to any existing database. PR #293 stays draft.
No resources have been provisioned and no Droplet has been accessed.

## Resources and isolation

Create a separate `chatforia-staff-qa` project and private VPC in NYC3 (subject to
account availability), with no peering to production. Do not reuse
`chatforia-web-01`, `chatforia-api-01`, `chatforia-db`, their disks, backups, SSH
keys, database credentials, OAuth applications, or notification/payment tokens.

| Proposed resource            | Size / purpose                                                              | Published monthly starting cost (USD) |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------: |
| `chatforia-staff-qa-web-01`  | Basic Regular 1 GiB; Nginx and prebuilt static client                       |                                    $6 |
| `chatforia-staff-qa-api-01`  | Basic Regular 2 GiB; Node 22, loopback-only Redis, synthetic jobs           |                                   $12 |
| `chatforia-staff-qa-db`      | New single-node Standard managed PostgreSQL, 1 GiB; synthetic source        |                                   $15 |
| `chatforia-staff-qa-restore` | Separate new managed PostgreSQL target, only during restore rehearsal       |                                   $15 |
| Private Spaces bucket        | Encrypted synthetic logical dumps and redacted evidence; separate key scope |                  $5 base subscription |

Base monthly equivalent: **$38**; with the temporary restore cluster: **$53**.
These are estimates from published starting prices, checked 2026-11-02, not an
account quote. Region, selected database storage/restore plan, transfer, retained
snapshots, taxes and a new domain can add cost. Require a final console quote
within a proposed **$60 pre-tax monthly-equivalent ceiling**; stop for approval
if it exceeds that. Proposed initial lifetime: seven days, with a separately
approved teardown after evidence export; idle resources continue billing.
No domain purchase, extra load balancer or paid monitoring service is included.

Sources: [Droplet pricing](https://www.digitalocean.com/pricing/droplets),
[PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/),
[Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/).
Actual short-run charges must use the provider's current billing/retention rules;
these monthly equivalents are not a seven-day invoice promise.

Use an approved user-owned **non-production registrable domain**, with separate
`web.staff-qa` and `api.staff-qa` hosts under it, public HTTPS certificates and
exact CORS origins. Domain availability/ownership is an approval prerequisite.
Do not place staging below `chatforia.com`: production parent-domain cookies
could otherwise reach it. Use distinct host-only cookie names, a fresh browser
profile and synthetic logins. Restrict HTTPS to tester IPs; SSH to named operators;
managed DB trusted sources to the new API/restore operators. Verify server TLS
identity with the provider CA; avoid broad public database sources.

Build from the reviewed SHA in an isolated builder. Use a separate approval-gated
staging procedure targeting only these named resource IDs. Never invoke the
existing production deployment workflows. Keep all production credentials out of
staging. Block production/external paid-service egress and use synthetic mail,
SMS/payment/AI/OAuth test integrations; review scheduled jobs before admitting
traffic. OAuth requires a separate sandbox client and explicit redirect URIs.

## Database and key preflight — stop on incompatibility

DigitalOcean managed PostgreSQL does not expose superuser access. Its actual
edition/version, custom-role membership and `pgcrypto` schema support must be
proved on the **new empty source**, before application deployment. Prefer Standard
PostgreSQL 16 matching local/CI if available; version/plan changes need review.
Do not use a new logical database on production `chatforia-db` as isolation.

Local `node server/scripts/staff-migration-qa.mjs` now verifies all 159 migrations
under a provider-like non-superuser DBA executor, strict owner validation and
runtime restrictions. It does not certify DigitalOcean's managed service.
The owner bootstrap no longer attempts superuser-only role normalization; an
unsafe pre-existing owner is rejected instead.

Provision `chatforia_dev` as the unprivileged runtime, the restricted NOLOGIN
security owner, and separate NOLOGIN recovery groups. Only the DBA migration
executor may temporarily need SET authority over the security owner for ownership
transfers. Never grant that membership to the runtime or recovery operators.
PostgreSQL 16 membership/grantor dependencies can prevent a simple membership
revocation. Do not use CASCADE: retain the sealed offline DBA credential or
explicitly reconcile grantor provenance under DBA review. The application never
receives that credential. Test transitive ACLs and startup drift rejection.

Recover encryption, JWT and staff-signing keys from a separate approved secret
store with staging-only values; verify the DB signing key through readiness.
Use independent issuer/executor login identities and named human operators.
Verify `pgcrypto` installs in the required `staff_security` schema; an existing
installation in another schema must not be silently ignored or relocated.
If the provider cannot satisfy the exact security model, stop: no superuser
runtime, broad grants, trigger bypass or migration guard removal is acceptable.

Provider reference: [user privileges and managed-service limitations](https://docs.digitalocean.com/products/databases/postgresql/how-to/modify-user-privileges/).

## Authorized execution would proceed in these gates

1. Record explicit resource/cost/domain/operator approval, reviewed SHA and all
   four security migration hashes. Record newly created resource and DB identities.
2. On the new empty source only, prove the preflight above, install the complete
   reviewed migration history and seed synthetic founder, administrators, staff,
   ordinary users and reports. Enable security with dashboard disabled initially.
3. Deploy the reviewed build to the new web/API pair; verify startup, full-shell
   password/TOTP/backup-code/OAuth sign-in and real HTTPS cookie/CORS/CSRF behavior.
   Enable only a synthetic staff cohort and repeat View/Edit, stale conflicts,
   session loss, revocation, direct SQL denials and atomic audits.
4. Execute the eight staging/manual gates in release-plan.md, including Firefox,
   Safari, keyboard/device checks and actual operator/secret recovery.
5. Take a consistent synthetic managed backup plus required logical role/ACL
   evidence, restore to the separately created empty target and prove readiness,
   MFA/new token writes, audits, sequences and replay/session rejection. Record
   measured RPO/RTO. Never restore a production backup for this exercise.
6. Rehearse an older synthetic snapshot after additional revocations/approval
   consumption. Fence traffic; prove the approved invalidation/key-rotation and
   audit/replay reconciliation policy before reopening. This remains unproved
   locally and must not be assumed safe from exact-snapshot restore success.
7. Validate alerts, dashboard-only containment and a compatible application
   rollback. Export evidence; approve resource teardown and retained backup costs.
   Production and merge decisions remain separate, later approvals.
