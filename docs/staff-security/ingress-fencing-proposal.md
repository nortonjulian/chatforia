# Stage 5 ingress and maintenance fence — proposed, not applied

This is a target-specific rule proposal for a separately approved change. It
does not authorize firewall, SSH, certificate, migration or process changes.
The [sanitized evidence](evidence/stage5-routing-backup-readonly-20261105.json)
distinguishes owner-provided DigitalOcean/Cloudflare facts from read-only host
checks. The owner confirmed all three DNS names are proxied and Cloudflare uses
Full (strict). The website's verified upstream certificate check stays enabled;
the reported 404 probe shows an HTTP response, not authenticated app readiness.

[Read-only follow-up](evidence/frontend-deploy-and-ingress-readonly-20261105.json)
records that frontend workflow run #623 was an actual successful deployment from
`main`, not a connection-only check. It exercised the stored runner SSH key after
key-only hardening, synchronized the frontend, and successfully ran the nginx
reload command. The API checkout remains older; live `/staff/session` returns
404. Local authorization/browser evidence does not certify a live staff rollout.

## Permanent origin ingress

At the approved window, obtain the current IPv4 and IPv6 source sets from
[Cloudflare's IPv4 list](https://www.cloudflare.com/ips-v4) and
[IPv6 list](https://www.cloudflare.com/ips-v6), compare them with the snapshot
below, and stop for review if they differ. The November 5 snapshot has 15 IPv4
and 7 IPv6 ranges. Use **all 22 CIDRs as sources in each HTTP/HTTPS rule**, not
Cloudflare's DNS A/AAAA answers or the visitor address. DigitalOcean permits
multiple source CIDRs per rule and blocks unmatched inbound traffic by default.

```text
IPv4: 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22
      141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20
      197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13
      104.24.0.0/14 172.64.0.0/13 131.0.72.0/22
IPv6: 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32
      2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
```

A second read-only check on November 5 matched all 22 official ranges above.
Refresh them again at the approved change window; this check does not approve
the rule edit.

| Target | Proposed inbound rules | Outbound / verification |
| --- | --- | --- |
| Existing `chatforia-api-firewall` on `chatforia-api-01` | Replace all-source TCP 80 and 443 allows with separate TCP 80 and TCP 443 allows from the 22 Cloudflare CIDRs. Keep **no** inbound 5002 rule. Narrow TCP 22 to verified operator egress `/32` and/or `/128` after its source and recovery path are approved; the backend GitHub Actions workflow is blocked before SSH. | Keep current broad TCP/UDP/ICMP outbound rules during this release so managed DB, Redis, OAuth, provider calls, DNS, ACME and package access are not unexpectedly cut off. Confirm the only attached firewall and test both IP families. |
| New DigitalOcean firewall attached only to `chatforia-web-01` | Separate TCP 80 and TCP 443 allows from the same 22 Cloudflare CIDRs. For the existing standard GitHub-hosted frontend SSH workflow, retain TCP 22 from all IPv4/IPv6 **only with approved key-only SSH hardening**. No other inbound rule. | Explicitly allow current outbound TCP/UDP/ICMP behavior; an empty outbound rule set would block egress. Test proxied web/API paths, direct-origin rejection, and a no-op Actions SSH connection before relying on the rule. |

The API operator SSH source was observed as one IPv4 address in a fresh
key-based connection. The exact `/32` is shared in the private owner review;
verify it again immediately before a rule edit and do not broaden it to a
residential `/24` by inference. No operator IPv6 source was established.

For an approved permanent edit, save the old rule sets and keep a tested SSH
session plus DigitalOcean console recovery. Add the Cloudflare source rules
before removing the API's all-source HTTP(S) allows. Build the web firewall
with SSH and outbound rules **before** attaching it. Test proxied IPv4/IPv6
HTTPS and HTTP redirects, normal browser API calls, configured provider
callback URLs, passive delivery status and direct-origin rejection. Do not
trigger paid provider actions as a test. If a path fails, restore the API's
prior allows or detach the new web firewall immediately; preserve the active
SSH session.
Do not change outbound policy as part of this release.

**Exact permanent-rule reversal:** For API, restore the captured original
all-source TCP 22/80/443 allow rules in `chatforia-api-firewall` before removing
the new Cloudflare/operator-source allows; preserve all prior outbound and
unrelated rules. Verify public HTTPS and fresh operator SSH after restoration.
For web, detach only the newly attached firewall, returning to the observed
no-cloud-firewall baseline; do not delete the rule snapshot until recovery is
verified. If a control-plane edit or SSH path fails, use the verified
DigitalOcean control panel to restore cloud rules; Recovery Console preserves
host access but cannot itself edit the DigitalOcean firewall. Stop further
network edits.

The independent web fetcher repeatedly reported `www` HTTP 521, while direct
TLS-verified checks through all four locally DNS-advertised Cloudflare addresses
and a direct known-origin diagnostic returned 200. Nginx was active and its
configuration parsed, but the failing fetcher exposed no Cloudflare Ray ID or
response headers. The owner additionally reported that `https://www.chatforia.com/`
loaded over cellular at 10:25 PM Denver time on November 4 (05:25 UTC November 5).
Web-origin access logs for 04:20–05:40 UTC had 152 responses with status 200,
16 with 301, five with 400 and no 5xx; the error log had no entries. In the
05:20–05:31 UTC interval, there were 91 responses with 200 and two with 301.
These aggregates cannot identify the owner's request or the failing fetcher;
a Cloudflare-generated 521 might not reach the origin. Do not infer a cause or
call this globally resolved. Review the affected edge/zone evidence or obtain
a reproducible external probe before
approving a tighter web origin rule; abort an approved change on any new 521.
[Cloudflare describes genuine 521 responses](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-521/)
as origin connection refusals; this fetcher's error lacks the metadata needed
to attribute it to a particular Cloudflare edge or origin rule.

The web and API are separate hosts, and only the API currently has a cloud
firewall attached. This unresolved
`www` symptom does not by itself prevent a separately approved **API-only**
firewall edit. The owner reconfirmed `chatforia-api-firewall` attaches **only**
to `chatforia-api-01`. The rule baseline remains the owner's earlier
control-panel report: inbound TCP 22/80/443 open to both IP
families, no TCP 5002 inbound rule, and broad outbound TCP/UDP/ICMP. No current
DigitalOcean control-plane rule read was available; obtain a fresh screenshot
or read-only API response showing the rules and attachment before editing.

The deployed API process is online in PM2 and runs the package's production
`start` script, which loads `server/.env.production`. A read-only classification
of its configured URL fields found that Google and Apple use HTTPS
`api.chatforia.com` with paths matching their deployed callbacks. The Twilio
voice URL uses the same HTTPS origin, while the Twilio webhook base adds `/api`.
The deployed code accepts
`/auth/google/callback`, `/auth/apple/callback`, `/billing/webhook`, Twilio SMS
under `/webhooks/sms` and `/api/webhooks/sms`, Twilio voice under
`/webhooks/voice` and `/api/webhooks/voice`, other Twilio/porting routes under
`/webhooks`, and a conditional eSIM webhook under `/esim/webhooks/oneglobal`.
This establishes application routes and selected configured hostnames, not the
destinations saved in Google, Apple, Stripe, Twilio or eSIM provider consoles.
There is also an existing routing mismatch: deployed code constructs a Twilio
regulatory status callback by appending `/webhooks/twilio/regulatory-status` to
the `/api` webhook base, but mounts that handler only without `/api`. API nginx
passes paths through unchanged. This mismatch is independent of the proposed
firewall and merits separate review before relying on regulatory callbacks.
Confirm that every active external callback points to a Cloudflare-proxied
hostname before narrowing API 80/443; a raw API IP or unproxied hostname would
be cut off. Avoid printing credentials or full callback URLs in review evidence.

The [provider callback follow-up](evidence/api-provider-callbacks-readonly-20261105.json)
records the owner's Twilio Console checks and read-only provider metadata. The
Voice Application used by current inbound numbers points to
`https://api.chatforia.com/api/webhooks/voice/inbound`; its fallback and status
callback are blank. The Low Volume Mixed A2P Messaging Service posts inbound
SMS to `https://api.chatforia.com/api/webhooks/sms/twilio`; its fallback and
delivery-status callback are blank, and number-level inbound override is off.
All effective current inbound Twilio voice/SMS destinations in the configured
account are proxied API routes or blank. Optional per-message and per-call
status callback environment fields are unset; code-generated voice/TwiML
callbacks use the configured API origin or relative `/webhooks/voice` paths.
Live Stripe metadata has one enabled webhook at `https://api.chatforia.com/billing/webhook`.
These findings close Twilio voice/SMS and Stripe **destination** checks for the
current snapshot, without testing live provider delivery. The pre-existing
Twilio regulatory callback route mismatch above remains a separate correctness
issue; its destination host is proxied.

The owner verified Google Play's actual push endpoint as
`https://api.chatforia.com/billing/google-play/rtdn`, matching the configured
OIDC audience and deployed handler. App Store Connect has **neither Production
nor Sandbox Server Notification URL configured**. Adding and verifying those
Apple URLs remains a separate launch-readiness task before enabling that
billing-notification flow; their absence is not an API firewall destination
blocker. Read-only GET of Twilio's documented Porting Webhook configuration on
the configured **parent** account returned 404 / Twilio 20404 (resource not
found); a read-only account list found zero subaccounts. There is no current
port-in or port-out destination through that
resource. The deployed porting code stores requests locally and has a receiver,
but neither registers a webhook nor submits Twilio port orders. Functional
porting is separate launch work, not a current firewall callback gate.

The remaining provider-destination question is whether the Telna account has
an enabled outbound event-webhook subscription; if so, obtain its destination
and subscribed event types. If none, Telna has no inbound callback needed for
the deployed pull-based usage flow. Recheck provider settings if they change;
do not repeat completed Twilio voice/SMS, Stripe or Google Play checks without
a concrete reason.

The deployed Telna **usage and remaining-data** flow does not require an
incoming callback. Opening Wireless triggers authenticated
`GET /api/wireless/status`; the API makes outbound
`GET /v2.1/pcr/packages/{package_id}` requests for recent purchased packages,
converts Telna's remaining bytes to MB, and persists only a decrease in the
customer's balance. It uses package status to separate ACTIVE usage from queued
NOT_ACTIVE top-ups. There is no timed usage poll or Telna callback registration
in the deployed call sites. The eSIM activation page performs a separate
one-time/manual outbound eUICC status lookup. The `/esim/webhooks/oneglobal`
handler only acknowledges a request without updating usage, while the generic
`/api/wireless/webhooks/:provider` route is authentication-gated and uses a
stub normalizer. The Telna webhook secret is unset. Merged
[eSIM PR #145](https://github.com/nortonjulian/chatforia/pull/145) already records
a successful real purchase, install, cellular usage accounting and active/queued
top-up checks; existing focused tests cover package-ID usage reads and the
balance cap. No test or provider transaction was repeated here.

Therefore the planned API **inbound** Cloudflare-only rule does not interrupt
the deployed Telna pull flow when outbound access remains unchanged. The
specific account question is whether Telna has an enabled outbound event
webhook/subscription for Chatforia. If none, remove Telna from the API firewall
destination gate. If enabled, verify its HTTPS destination and event types;
an existing handler's presence alone does not establish a working Telna
callback. Telna's public [Connect Flex webhook setup](https://flex-developer.telna.com/reference/setting-up-webhooks)
describes opt-in event subscriptions, but does not establish that this Connect
v2.1 account uses one.

According to [DigitalOcean's firewall limits](https://docs.digitalocean.com/products/networking/firewalls/details/limits/),
cloud firewalls are stateful and currently available without an additional
charge. Do not attach a second broad-allow firewall: allows from multiple
attached firewalls combine. Adding a rule does **not** close existing
connections ([rule behavior](https://docs.digitalocean.com/products/networking/firewalls/how-to/configure-rules/)),
so a firewall edit alone cannot fence an active API writer.
Recheck attachments and source lists before every approved rule edit. The API
process currently listens on `*:5002`; the absence of a cloud inbound rule is
the observed network boundary for that port. Binding to loopback is a separate
hardening change, not assumed here. Before applying Cloudflare-only HTTPS,
confirm each externally configured provider callback/webhook uses a proxied
hostname rather than the raw origin IP or another unproxied name.

## SSH and GitHub Actions decision

The separately approved [SSH key-only change](ssh-hardening-change.md) is now
applied on both hosts. Effective `sshd -T` reports `PasswordAuthentication no`,
`KbdInteractiveAuthentication no`, `AuthenticationMethods publickey` and
`PermitRootLogin without-password`; fresh no-op logins with locally available
deployment-labeled keys passed. Frontend run #623 then exercised the stored
Actions key successfully from a hosted runner, but used the old deployment
workflow's unpinned `ssh-keyscan` host trust. PR #301's pinned connection-only
mode remains unrun. Do not turn off root key login until a separate
non-root path is verified.

`.github/workflows/deploy.yml` uses a standard `ubuntu-latest` runner to SSH
and rsync to the web host. [GitHub says](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses)
these runner egress IPs are dynamic and does not recommend allowlisting them
by IP. Keeping web TCP 22 public but
key-only is the zero-cost continuity option. Narrowing web TCP 22 requires a
different, approved deploy transport with fixed egress (for example, operator
SSH from a known source); do not guess a GitHub runner range. The legacy backend
workflow stops before SSH and is not the Stage 5 deployment path. Neither
legacy deployment workflow may be dispatched for the staff cutover. The web
workflow currently obtains its host key with `ssh-keyscan`; pin a separately
verified host key before it is next trusted for deployment.

## Certificate renewal

The web origin certificate in active nginx expires April 8, 2041; no Certbot
renewal entry or timer was found there. Cloudflare's edge certificate is a
separate provider-managed concern. The API's active Let's Encrypt certificate
for `api.chatforia.com` expires January 25, 2027. Its enabled/active Certbot
timer uses the nginx authenticator, which uses
[HTTP-01 on TCP 80](https://eff-certbot.readthedocs.io/en/stable/using.html). Keep API TCP
80 reachable from Cloudflare's full source set, including during a short API
HTTPS maintenance fence. After any approved permanent allowlist change, run a
separately approved **active-lineage-only** Certbot dry-run and confirm the
challenge reaches the origin through the proxied hostname before calling
renewal safe. Do not alter the verified website nginx upstream TLS settings.

The API host also has an expired `chatforia.com` Certbot renewal lineage dated
April 1, 2026 that active nginx does not reference. Its disposition needs a
separate reviewed maintenance decision; it is not evidence that the active API
certificate has renewed successfully. Do not delete it as part of firewall
preparation or count a blanket `certbot renew` failure as proof that the active
API lineage failed.

## Temporary migration fence and reversal

The deployed frontend loads `env.js` and calls `https://api.chatforia.com`
directly; the web server's `/api/` proxy is a second path. During a separately
approved migration window, keep the web firewall and SSH rules unchanged.
Record the exact pre-window API rule set and an operator public source outside
the Cloudflare CIDRs. Add a temporary API TCP 443 **deny** from the 22 Cloudflare
CIDRs (deny wins over the permanent allow) and a temporary TCP 443 allow from
the operator `/32` or `/128` for private origin smoke. Leave TCP 80 from
Cloudflare in place for the HTTP-01 path. If no reliable operator source,
console rollback access or private smoke route exists, do not start the fence.

Then drain requests, stop the old API and every in-process/background writer,
and verify the old listener and DB sessions are gone. DigitalOcean retains
established connection state across rule edits, so stop/drain is required even
if fresh public HTTPS connections are denied. Confirm a new public API request
fails closed and a direct operator request reaches the expected API origin;
the old 404 probe is not this verification. Provider callbacks and webhooks are
also fenced: approve an outage/retry window and reconcile missed deliveries
before reopening. Check the next Certbot timer before fencing. If it overlaps
the window or the challenge flow requires HTTPS, postpone the fence; pausing
and resuming the timer would itself require a reviewed production action. Do
not run renewal during the HTTPS fence.

Only after the restricted runtime preflight and private auth/MFA, role, write,
upload and job checks pass should the operator remove the temporary deny and
private TCP 443 allow. Verify normal Cloudflare-routed traffic, callbacks and
alerts. On any security, availability or renewal regression, reapply the fence,
stop the new runtime and preserve logs/receipts; follow the reviewed recovery
plan. Do not restart the old privileged PM2 application after migrations.

## Decisions needed before any network change

1. Approve or reject the temporary key-only **public web SSH** rule needed to
   preserve the current GitHub-hosted frontend workflow; alternatively choose
   a fixed-egress deployment method and narrow TCP 22 first. Confirm the
   workflow's SSH destination is the direct web Droplet, not a proxied hostname.
2. Provide the operator source CIDR(s) for API SSH and private HTTPS smoke.
   The owner reported successful Recovery Console root login on both Droplets;
   reconfirm it before any firewall change. Confirm provider callback/webhook
   retry tolerance and the exact maintenance window.
3. Separately approve the web firewall attachment, API rule edits,
   active API certificate dry-run, and the temporary migration fence. None is
   authorized by this proposal. Exception activation, migrations, deployment
   and cutover retain their own approval gates.
4. Review the expired, unused API-host `chatforia.com` renewal lineage before
   relying on the unattended Certbot timer; do not remove it without approval.
