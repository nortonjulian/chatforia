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
this as user-reported. The subsequent SSH/catalog inspection below independently
establishes runtime identity, SQL privileges, ownership and extension state.
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

## Authenticated Droplet and database inspection — completed

The owner confirmed `chatforia-web-01 = 24.144.80.189` and
`chatforia-api-01 = 157.230.128.247`. There is no local user SSH config.
The existing development checkout's `DEPLOYMENT.md` identifies `DO_USER=root`
and a root SSH example for the web address; deployment workflows reference
secret usernames without revealing their values. Existing deployment keys
successfully authenticated **root on both named hosts**, with strict existing
known-host verification. Hostnames matched. No credentials were printed.

[Sanitized inspection evidence](evidence/live-infrastructure-inspection.json)
supersedes the earlier access limitations in the historical public-edge report.
Remote Python ran from stdin without writing files or bytecode. SQL used the
existing API connection internally with `BEGIN READ ONLY`, read-only defaults,
statement/lock timeouts and rollback. Only catalogs and migration metadata were
queried; no customer rows, stored MFA/recovery material or credential values
were returned. No service, configuration, role or database was changed.

### Actual database boundary

- **PostgreSQL 18.6, defaultdb, runtime/session role doadmin**; TLS 1.3 observed.
  The existing connection specifies `sslmode=require`; verified server identity
  was not established by this inspection. Prepare the correct CA/hostname policy
  before cutover, without exposing connection strings.
- `doadmin` is not a superuser, but has **CREATEROLE, CREATEDB, REPLICATION and
  BYPASSRLS**, owns defaultdb/public and all observed public tables/sequences.
  It owns the protected user/token/audit tables and can update/truncate/control
  their triggers. This cannot be the restricted staff application role.
- All four required roles (`chatforia_dev`, `chatforia_staff_owner`,
  `chatforia_recovery_issuer`, `chatforia_recovery_executor`) and `staff_security`
  are absent. A separately approved DBA bootstrap and runtime-credential cutover
  are required. Do not alter provider-managed roles or use blanket ownership
  reassignment. `doadmin` can remain the separately held DBA/table owner.
- **pgcrypto 1.4 is available but not installed**. There is no installed namespace
  conflict. Availability does not prove permission to install/transfer extension
  ownership on DigitalOcean; no such mutation was attempted.
- The 144 ledger rows comprise **141 completed active migrations and three
  historically rolled-back attempts**, with no unresolved failed migration and
  no staff migration applied. All expected baseline names exist, but only
  **137/141 checksums match**.

The four mismatches are:

1. `20260726034500_add_wireless_refund_audit`
2. `20260806030000_add_pstn_reporting_and_blocking`
3. `20260807010000_add_sandbox_apns_tokens`
4. `20261013_add_esim_replacement_audit`

Their current SQL bytes match the PR, inspected main
`5a110738355d5d38aa9a9cf9826b511b0d7d6cec`, deployed API commit
`b0ec6fd0fa5858633aad51ad5ef1a9e6b0346b70`, and actual deployed files. None matches
the recorded applied checksum. Available Git history, simple line-ending/BOM
variants and adjacent migration backup candidates did not recover the applied
SQL. This is **pre-existing drift**, not a branch-introduced migration edit.

A limited catalog comparison checked 70 expected columns/types, indexes and
named constraints: 68 matched directly; two original non-unique Device indexes
were intentionally replaced by the completed
`20260807223500_unique_push_token_ownership` migration. Both unique replacements
are present and valid. No unexplained difference appeared in that limited
comparison. It does **not** prove full schema/default/FK-action equivalence or
resolve SQL provenance. The strict deployment preflight must continue to reject
the four checksum mismatches. Obtain trusted applied SQL/deployment artifacts or
a separately reviewed reconciliation plan; do not rewrite ledger checksums,
mark migrations resolved or waive the check to proceed.

### Process, HTTPS and secret custody

The API runs as root under PM2 6.0.14, with one HTTP listener on `*:5002`, Redis
on loopback with protected mode enabled, and nginx forwarding API HTTPS to
`127.0.0.1:5002`. Express trusts one proxy. The observed production cookie domain
is `.chatforia.com` with secure cookies enabled. The saved PM2 entry uses fork
mode. `pm2-root.service` is enabled but inactive while the daemon/application
are running; `chatforia-api.service` is disabled/inactive. A reboot/process
rollback was not attempted and remains unverified.

The API origin has a valid Let's Encrypt certificate through **2027-01-25**;
direct SNI/hostname-verified TLS 1.3 negotiation succeeded. Its nginx TLS include
permits TLS 1.2/1.3 and forwards scheme/host/client headers. The web host serves
the SPA and proxies API requests to `https://api.chatforia.com`, with SNI enabled
but **`proxy_ssl_verify off`**. Its Cloudflare Origin CA certificate is valid
through **2041-04-08**. Cloudflare's actual encryption mode and configured origin
routing remain account-only evidence; the API host also has a frontend virtual
host, so public Cloudflare DNS does not establish which origin serves the SPA.
Correct upstream certificate verification before the staff rollout.

UFW is inactive on both hosts. One external connection attempt to API port 5002
timed out; this is neither proof of public exposure nor proof of the intended
cloud firewall policy. DigitalOcean Cloud Firewall rules are still needed to
establish that clients cannot bypass the trusted proxy.

The inspected application environment files, same-host backup and PM2 dump are
root-owned **0600**, and the real env files are untracked by Git. Existing
`APP_ENC_KEY` (32 decoded bytes) and JWT keys are present and match inspected
same-host copies. **SESSION_SECRET is absent in inspected process/file sources;
the deployed session configuration has a literal fallback.** Provision an
independent strong session key through an approved cutover (expect session
invalidation); do not retain that fallback for staff access. The new
`STAFF_ACCESS_SIGNING_SECRET` is also absent and must be provisioned with its
matching protected database key. Preserve the existing MFA encryption key.
No values or key hashes were printed or recorded.

These same-host copies do not establish independent recoverable custody. The
application currently runs as root and privileged database credentials are in
its environment sources/PM2 state: replacing one DATABASE_URL is insufficient.
The approved cutover must keep DBA/recovery credentials outside the application's
effective access, including backup env files and saved process state. The OS
identity/access boundary needs an explicit plan; file mode alone is not proof.

No direct git-pull/deployment polling was found in the inspected root crontabs,
system cron locations, systemd unit files or timer inventory. This bounded
inspection cannot rule out external automation. No deployment was dispatched.

## Remaining account and human evidence

No DigitalOcean connector/browser session, installed `doctl`, standard local
doctl configuration or DigitalOcean token environment variable is available.
No standard doctl credential/token candidate was found in the inspected API-host
locations either. SSH/database access succeeded; the limitation is now account
inventory/settings and independent human recovery evidence, not SSH credentials.

## Exact missing console screens or redacted metadata

1. **DigitalOcean → Networking → Firewalls → rules and attached Droplets:**
   inbound ports/sources applying to both named hosts, especially API port 5002;
   Droplet/DB Networking VPC membership and endpoint type. Database Network
   Access already lists only the API host; do not change it or request it again.
2. **chatforia-db → Overview → Actions → Restore from backup:** available
   actual earliest/latest recovery timestamps and recorded backup health/status.
   Recovery modes, seven-day window and new-cluster destination are already
   reported; no need to repeat that inspection. Inspect
   only; do not click **Restore to New Cluster**. Provide any existing restore
   rehearsal reference, duration, RPO/RTO and independent destination metadata.
   Documented capability is not proof that this account's backups are healthy.
3. **Actual secret custody process:** storage mechanism and access-control
   metadata, owner/group/file mode if file-backed, whether the existing MFA
   encryption key and JWT/session keys have a separately recoverable copy,
   named independent custodians and last recovery-drill date/result. For the new
   staff key, report only whether provisioning/rotation is prepared. Do not send
   values, hashes, screenshots with revealed values or complete environment files.
   A key being present on an app process does not prove recoverable custody.
4. **Cloudflare → chatforia.com → SSL/TLS → Overview and origin configuration:**
   encryption mode and any Origin Rules/Tunnel override; certificate validity
   and which origin each hostname targets, not certificate private keys.
   Certificate/proxy/process metadata above is already inspected; do not request
   raw `pm2 env`, environment dumps, access logs or customer query records.
5. **DigitalOcean → Projects/Resources, Droplets, Databases and Billing:**
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

**GO for implementation review; NO-GO for deployment.** SSH/catalog/configuration
inspection is complete to the available access boundary. Known blockers now
include four unresolved baseline checksum mismatches, privileged runtime
credentials, missing restricted roles/schema/staff key, missing session secret
and disabled upstream certificate verification. These existing target conditions
must be addressed by a reviewed, separately authorized cutover; the PR preflight
must not be weakened. Provider restore success, independent key custody, cloud
firewall/Cloudflare policy and process rollback still need evidence. No already-
paid dedicated sandbox has been identified; the existing test databases share
production's role namespace and are not suitable. The smallest next evidence is
trusted applied SQL/provenance for the four drifted migrations plus the exact
account/custody metadata above. No spending or production mutation is authorized.
