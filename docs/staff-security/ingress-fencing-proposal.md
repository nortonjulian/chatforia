# Stage 5 ingress and maintenance fence — proposed, not applied

This is a target-specific rule proposal for a separately approved change. It
does not authorize firewall, SSH, certificate, migration or process changes.
The [sanitized evidence](evidence/stage5-routing-backup-readonly-20261105.json)
distinguishes owner-provided DigitalOcean/Cloudflare facts from read-only host
checks. The owner confirmed all three DNS names are proxied and Cloudflare uses
Full (strict). The website's verified upstream certificate check stays enabled;
the reported 404 probe shows an HTTP response, not authenticated app readiness.

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

| Target | Proposed inbound rules | Outbound / verification |
| --- | --- | --- |
| Existing `chatforia-api-firewall` on `chatforia-api-01` | Replace all-source TCP 80 and 443 allows with separate TCP 80 and TCP 443 allows from the 22 Cloudflare CIDRs. Keep **no** inbound 5002 rule. Narrow TCP 22 to verified operator egress `/32` and/or `/128` after its source and recovery path are approved; the backend GitHub Actions workflow is blocked before SSH. | Keep current broad TCP/UDP/ICMP outbound rules during this release so managed DB, Redis, OAuth, provider calls, DNS, ACME and package access are not unexpectedly cut off. Confirm the only attached firewall and test both IP families. |
| New DigitalOcean firewall attached only to `chatforia-web-01` | Separate TCP 80 and TCP 443 allows from the same 22 Cloudflare CIDRs. For the existing standard GitHub-hosted frontend SSH workflow, retain TCP 22 from all IPv4/IPv6 **only with approved key-only SSH hardening**. No other inbound rule. | Explicitly allow current outbound TCP/UDP/ICMP behavior; an empty outbound rule set would block egress. Test proxied web/API paths, direct-origin rejection, and a no-op Actions SSH connection before relying on the rule. |

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
deployment-labeled keys passed. The GitHub Actions secret itself was not
exercised from a runner. Do not turn off root key login until a separate
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
