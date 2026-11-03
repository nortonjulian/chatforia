# Read-only deployment inspection — 2026-11-03

The owner authorized inspection of existing DigitalOcean deployment/database
configuration. No permission was granted to modify production, run migrations,
restart services, merge, deploy, restore backups or provision resources.

## Owner-reported console evidence — recorded

The owner reports `chatforia-db` runs **PostgreSQL 18**, **primary-only**, in
**SFO2**. Network Access lists only **chatforia-api-01**. Users lists **doadmin**;
databases are **defaultdb** and two existing voicemail/wireless test databases
(exact test database names were not supplied).

The restore dialog offers **latest-transaction or point-in-time recovery up to
seven days into a new cluster**. No restore was performed; restore success,
actual recoverable time points and measured RPO/RTO remain unverified. This
closes the console-visible version/topology/network-source and advertised
recovery-capability subchecks; it is not a restore rehearsal.

[Console evidence record](evidence/digitalocean-console-report.json) identifies
this as user-reported. The console user list is not the complete SQL role graph:
it neither proves runtime uses doadmin nor proves all required NOLOGIN roles are
absent. Runtime connection identity, actual database name, SQL attributes,
memberships, owners, migration ledger and pgcrypto namespace remain unknown.
Primary-only topology is an existing availability characteristic, not by itself
a new staff-security defect. The two test databases share the production cluster's
role namespace and do not establish an isolated sandbox.

## PostgreSQL 18 compatibility follow-up — locally verified

Installed PostgreSQL **18.3** tools enabled a fresh, synthetic, zero-cost run of
the populated upgrade/preflight rehearsal. **11/11 checks passed**, including
141→159 migrations under a non-superuser executor, unchanged existing user rows,
runtime restrictions, key-match verification and rejection of unsafe role,
ownership, extension-namespace and migration-history states. The new cluster
stopped; no existing database or browser suite was used. See
[PostgreSQL 18 evidence](evidence/postgres18-upgrade-local.json).

The preflight's previous PostgreSQL-16-only check would reject the reported
target. It now explicitly accepts the two locally exercised major versions,
**16 and 18**, while retaining all privilege, history and signing-key checks.
The rehearsal report now records the actual server version. All 18 migration
SQL files remain unchanged. This resolves the local engine-version evidence gap,
not DigitalOcean-specific permissions or installed extension compatibility.

DigitalOcean lists pgcrypto for PostgreSQL 18, but extension availability alone
does not establish its installed namespace, owner or the executor's permissions.
See [supported extensions](https://docs.digitalocean.com/products/databases/postgresql/details/supported-extensions/).
No extension installation/relocation or role alteration was attempted remotely.

## Verified so far

Unauthenticated HEAD requests and normal certificate validation confirmed:

| Endpoint | Observed result |
| --- | --- |
| chatforia.com, www.chatforia.com, api.chatforia.com | HTTP 301 to HTTPS; HTTPS 200; trusted certificate; TLS 1.3; Cloudflare edge |
| api.chatforia.com | HSTS `max-age=15552000; includeSubDomains`; allowed origin `https://chatforia.com`; credentials allowed |
| API CSRF cookie | Secure, HttpOnly, SameSite=Lax; value neither printed nor retained |
| Frontend root responses | No HSTS header observed; existing hosting hardening observation, not a new branch regression |

[Sanitized machine record](evidence/public-edge-inspection.json). No customer
records, response bodies, credentials, private keys or cookie values were
printed. These observations close only the **public edge reachability/TLS and
observed API header** subchecks. They do not establish Cloudflare-to-origin TLS,
proxy trust, authenticated session-cookie behavior, database safety or recovery.
Completed browser/Google tests were not repeated. CI 141/142 remain the earlier
successful checkpoints; follow-up CI for the new tooling is separate evidence.

## Concrete access limitations

No DigitalOcean connector/browser session, installed `doctl`, standard local
doctl configuration or DigitalOcean token environment variable is available.
Existing deployment SSH keys and two trusted SSH hosts are present, but there is
no SSH config mapping them to `chatforia-web-01` / `chatforia-api-01` or identifying
the SSH usernames. Reverse DNS supplies no names; public DNS resolves to
Cloudflare, not Droplet addresses. The owner has been asked for the mapping and
usernames only. No SSH authentication attempt has been made against an unverified
host. This is missing target identity, not evidence that an existing key failed.

The development database URL found in the ordinary development checkout points
to localhost. It was not used as production evidence or connected to. No database
or Droplet connection has been established during this inspection yet.

## Exact missing console screens or redacted metadata

1. **DigitalOcean → Droplets → each named Droplet → Overview/Networking:**
   match name to public IP; provide the existing SSH login username separately.
   No private key/password is needed: deployment keys already exist locally.
   Once identified, the authorized inspection can read process/configuration
   metadata without restarts or copying environment contents.
2. **DigitalOcean → Databases → chatforia-db → Overview:** engine edition and
   remaining VPC/endpoint identity and actual runtime database name (omit password/
   connection URI). Major version, region, topology, visible user and network
   source are already recorded above; do not request those again.
   The console's user list alone does not prove SQL privileges: still need
   catalog-only role attributes/memberships, database/schema/table owners,
   pgcrypto version/schema/owner and migration names/checksums/completion state.
   No User/AuditLog/customer rows or stored signing-key values are needed.
3. **chatforia-db → Overview → Actions → Restore from backup:** available
   actual earliest/latest recovery timestamps and recorded backup health/status.
   Recovery modes, seven-day window and new-cluster destination are already
   reported; no need to repeat that inspection. Inspect
   only; do not click **Restore to New Cluster**. Provide any existing restore
   rehearsal reference, duration, RPO/RTO and independent destination metadata.
   Documented capability is not proof that this account's backups are healthy.
4. **Actual secret custody process:** storage mechanism and access-control
   metadata, owner/group/file mode if file-backed, whether the existing MFA
   encryption key and JWT/session keys have a separately recoverable copy,
   named independent custodians and last recovery-drill date/result. For the new
   staff key, report only whether provisioning/rotation is prepared. Do not send
   values, hashes, screenshots with revealed values or complete environment files.
   A key being present on an app process does not prove recoverable custody.
5. **Cloudflare → chatforia.com → SSL/TLS → Overview and origin configuration:**
   encryption mode and any Origin Rules/Tunnel override; certificate validity
   and hostname coverage, not certificate private keys. The Droplet inspection
   also needs nginx upstream/proxy-header settings, listener binding, process
   count/manager, deployed SHA, environment-file ownership and deployment
   cron/timer/hook presence. Avoid raw `pm2 env`, environment dumps, access logs
   or customer request/query records.
6. **DigitalOcean → Projects/Resources, Droplets, Databases and Billing:**
   existing resource names/types, assigned environment/purpose and current plan
   status. To certify a $0 sandbox, identify an already-paid **dedicated**
   non-production host/cluster with synthetic data, independent credentials,
   role namespace, ingress/egress and no production mounts or integrations.
   A replica or another logical database on chatforia-db is not sufficient.
   No such sandbox can currently be confirmed; this is not a claim none exists.

DigitalOcean documents daily PostgreSQL backups retained seven days and restore
to a **new** primary cluster. These are provider capabilities, not inspected
chatforia-db backup evidence. See the official
[restore procedure](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/).
The provider also documents that privilege details require a PostgreSQL client,
and distinguishes encrypted `sslmode=require` from identity-verifying
`sslmode=verify-full`; see
[privilege and TLS guidance](https://docs.digitalocean.com/products/databases/postgresql/how-to/modify-user-privileges/).
No restore or privilege-change operation from those pages was executed.

## Updated decision

**GO for implementation review; NO-GO for deployment remains.** Public edge
TLS/header subchecks have observed evidence. Console version/topology, network
source and recovery options are now owner-reported, and PostgreSQL 18 local
upgrade verification passes. Actual SQL privileges/ownership/pgcrypto, restore
success, key custody, origin/process configuration and dedicated sandbox
inventory remain unverified. Read-only inspection is authorized; do not ask for
that authorization again. The immediate prerequisite is the named Droplet
IP/SSH-user mapping, particularly for chatforia-api-01, the sole reported database
network source. Do not add the workstation to Network Access or use the existing
test databases as an isolated role/migration sandbox. Account-only remaining
backup and sandbox questions need the redacted metadata above or an available
authenticated read-only account connection. No spending or production mutation
is authorized.
