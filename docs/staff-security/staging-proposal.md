# Zero-additional-cost verification plan — no paid provisioning authorized

This replaces the earlier paid staging proposal. The owner explicitly declined
spending and paid provisioning. No new cloud resources, subscriptions, domains,
paid runners, snapshots, storage or provider usage are authorized. Free credits
are not permission to create billable resources. PR #293 remains draft; no merge,
deployment, existing infrastructure access or existing-database migration is
permitted. Planned additional cloud spend: **$0**.

## Resources actually used and local checks

Use the existing workstation and installed Node, Chrome, PostgreSQL utilities
and dependencies. New synthetic clusters are initialized in private temporary
directories, verified by data-directory identity, bound to loopback, and stopped
on exit. They never reuse an existing database, cluster directory, dump or
production dataset. No server listens on a production interface. Test keys,
passwords and provider identities are generated locally; no production credentials
or dotenv files are supplied to the full-app probe. Existing passing suites are
retained as evidence instead of rerun without a change.

| Missing check                                                                                    | Zero-cost local evidence / remaining boundary                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web/mobile OAuth MFA gates, callback state, issuer/audience/signature/nonce and replay rejection | Additional offline suites: 53/53 pass using mocked providers/Redis/database clients and locally generated signing keys. No real provider account called.                                                                                                                                                           |
| Real application factory password/TOTP/cookie-session staff routing                              | New synthetic full-app HTTP probe; real routes and runtime DB, test-mode Redis and dummy payment config. This is not a production-hosting or full browser-shell certification.                                                                                                                                     |
| Older-snapshot revocation/approval/audit loss                                                    | New source and restore clusters deliberately snapshot BEFORE security changes. The test reproduces revived session/staff access and forgotten assertion consumption offline.                                                                                                                                       |
| Containment after that older restore                                                             | Rotate JWT/assertion keys, increment session versions, revoke restored staff assignments, expire restored approvals, append containment audit and retain external synthetic audit evidence. Test readiness and new MFA/token writes. Traffic remains fenced; no reopening or complete reconciliation is certified. |
| View/Edit save/cancel/validation/denial, keyboard, stale conflict; exact-snapshot restore        | Already passed 26-check rehearsal; not rerun for this documentation change.                                                                                                                                                                                                                                        |
| Non-superuser executor migration/owner boundary                                                  | Already passed 159 migrations in fresh local PostgreSQL; not a DigitalOcean certification.                                                                                                                                                                                                                         |

Commands for new evidence:

- `node server/scripts/staff-offline-auth-qa.mjs`
- `node server/scripts/staff-older-snapshot-qa.mjs` (also runs the real-app HTTP probe)

Private summaries: `/tmp/chatforia-staff-offline-auth-report.json` and
`/tmp/chatforia-staff-older-snapshot-report.json`. The latter names the private
artifact directory and records that traffic was never reopened. Artifacts contain
only synthetic data. The containment sequence is a test, not a production restore
tool: it accepts no existing connection/archive and cannot be pointed at a live DB.

## Zero-cost checks still needing human participation

These do not inherently need DigitalOcean or paid resources:

- Full client browser shell/UserContext sign-in and navigation, including
  administrator View/Edit after actual sign-in. The new full-app probe covers
  server routing, not the complete browser shell or all UI context transitions.
- Safari/WebKit, supported Firefox renderer host, screen reader, real mobile
  device, keyboard/focus and accessibility review. Chrome keyboard/mobile viewport
  evidence already passes. Firefox failed on this host; WebKit is not installed.
- Real OAuth sandbox consent/redirect/MFA and operator identity-verification
  exercises with independently controlled human identities. Offline mocks cannot
  prove provider console configuration or a human verification process.
- Recovery through the organization's actual secret store and incident approval
  process, and review of how authoritative external post-backup audit/security
  records will be reconciled before any service is reopened.

Use existing authorized local devices, free sandbox identities and already-owned
non-production domains only. If any dependency would add cost or require access,
leave that check pending. No permission is inferred for using an account/device.

## Checks that need an actual isolated DigitalOcean environment

Local PostgreSQL cannot prove the managed service's doadmin restrictions,
transitive memberships, custom-schema pgcrypto availability, provider CA/TLS,
trusted-source firewall behavior or ownership/GRANTED BY handling in a provider
restore. Local pg_dump/pg_restore cannot certify managed backup/PITR consistency,
retention, cluster restore semantics, recovery duration at service scale or the
provider's lost-security-state behavior. An ordinary local app cannot attest to
Droplet Nginx/proxy/cookie/CORS configuration, deployed job/egress configuration,
real alert delivery or a hosted compatible rollback.

These remain **pending**. The exact manifest and application security restrictions
must stay intact; a provider incompatibility is not grounds for broader runtime
privileges, trigger bypass or removing prerequisites. The local old-snapshot
containment pass does not waive managed-service restore or reopening gates.

## Can existing infrastructure provide isolation without more spending?

No existing infrastructure was accessed or inventoried. The known resources are
production `chatforia-web-01`, `chatforia-api-01` and managed `chatforia-db`.
Repository evidence does not establish any unused, independently isolated
resources or spare included capacity. Therefore none is currently approved.

- **A separate database on chatforia-db is insufficient.** PostgreSQL roles and
  memberships are cluster-wide, while the migrations use fixed runtime/owner/
  recovery role names. Reusing or altering them risks production authority even
  when application tables are in another database. Privileged executor credentials,
  shared capacity and provider backups/restore may span production data. Do not
  provision roles, apply migrations or exercise recovery there.
- **A container or second process on a production Droplet is not certified
  isolation.** It shares the kernel, CPU/memory/disk, interfaces and potentially
  credentials, uploads, Redis, Nginx and scheduled jobs. Ports/namespaces alone do
  not establish zero production impact. No deployment or test load there is
  authorized, and the proposal does not assume it can be made safe at no cost.
- **Already-paid dedicated non-production resources might qualify**, but only if
  an owner-supplied inventory and separately authorized read-only assessment show:
  no production data/backup/credentials or peering; an independent PostgreSQL
  cluster with its own roles and empty target; isolated app hosts/network; and no
  metered storage, restore, transfer or scaling charges. A separate project label
  alone is not a security boundary. There is no evidence such resources exist.

If no already-paid, dedicated provider sandbox exists, the managed-role,
provider-backup/PITR and real hosted-topology checks genuinely require a separate
provider environment, normally billable. A managed restore also needs an
independent target and may incur charges. They remain explicitly unperformed;
there is no paid fallback, minimum spend or standing provisioning approval.

## Cleanup and evidence retention

All new local PostgreSQL processes stop in finally blocks; the full-app HTTP probe
uses temporary Supertest listeners only. Keep private synthetic dumps and reports
for review; do not delete existing user work or unrelated artifacts. No keys or browser state are committed or printed. Synthetic signing-key
material necessarily exists in the private PostgreSQL data/dump; the encryption
and JWT environment keys remain process-only. These artifacts contain no real
credentials. Any later deletion of local evidence should target
only its recorded task-owned directory after retention is agreed.

No cloud cleanup is required because no cloud resources were created. Do not
change or delete production resources, DNS, webhooks, credentials or subscriptions.
Before any future existing-resource assessment, obtain separate explicit access
approval; before any billable resource, obtain new spending/provisioning approval.
