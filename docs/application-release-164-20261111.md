# Combined SMS, quiet-hours, and voicemail application release

This is a **proposed** release assembled from draft PRs #323 and #324 on main
`dbf5887ebf64d87a649a8a033e5b66b1539b7b7e`. It does not change the
completed staff-security cutover or its archived 160/161-migration packages.
The exact integration commit must be reviewed again after either PR changes.

## Pinned migration boundary

The approved v2 staff/consent base has 161 SQL migrations. The distinct
`applicationMigrationRelease.v3.json` pins that full base digest and these
three later migrations, for **164 total**:

| Order | Migration | SHA-256 |
| --- | --- | --- |
| 162 | `20261109010000_sms_message_read_receipts` | `8e99dd90ec1c7e436e1674dc51c9de6dac9816b0a22a4e1b3047461a5fc1973a` |
| 163 | `20261110010000_forwarding_quiet_hours_time_zone` | `c0ae138a7fe8964998833c2359a6e75b2ad14a309fcc94346a545ebe83ae9626` |
| 164 | `20261111010000_voicemail_email_delivery_outbox` | `c270299272798d230705c655b268bc3244889174d630b60c289dbb3ec28dfeab` |

The complete 164-file set digest is
`21896086d07c00ef8f216a500dcd87f76e10a07d7d028774b90b5db13bdf549b`.
The separate v3 manifest remains `proposed-not-authorized-for-production`.
The old v1 and v2 manifests and checksum exceptions remain pinned. The new
history checker requires the completed 161-file v2 ledger, its three historical
rolled-back attempts, and the same four previously accepted checksum pairs;
it rejects any missing, extra, altered, or prematurely applied new migration.

The package review includes unchanged User/SMS/voicemail counts, a zero-after
predicate for legacy incoming SMS rows that should receive `readAt`, and the
new outbox table's expected absence/presence. Disposable PostgreSQL 18 QA also
checks an unseen arrival stays unread, existing accounts retain a NULL quiet
hours zone, and the restricted runtime can update the zone and SMS read receipt,
claim an outbox row, and mark a voicemail sent without staff-table write access.
The outbox uses a string key, so it adds no sequence permission.

## Order and activation gates

1. Review both PR heads and this integration diff. Merge and archive only after
   the separately pinned package and all affected PR checks pass. Rebuild the
   package from the resulting full main commit, verify its SHA-256 against
   independently reviewed bytes, and retain it separately from earlier packages.
2. Obtain explicit owner approval for this **v3** migration set, production
   preflight, schema execution, and API deployment as separate decisions. The
   prior v2 approval does not approve any of these three new migrations. The
   current manifest and its pinned SHA-256 are deliberately **proposed**; an
   approval requires a separately reviewed status/checksum revision, a new
   commit-bound package, and passing CI before the production runner can open.
3. Under an approved change window, take and verify the new release backup and
   target ledger/aggregate preflight using the privileged migration executor.
   Apply the three SQL files using the reviewed package runner, never the
   restricted API connection or legacy direct `prisma migrate deploy` path.
   A partial migration needs ledger and schema inspection; it cannot be safely
   undone by restarting the old API or relabeling the ledger.
4. Deploy the compatible API **after** all 164 migrations and narrow grants
   pass. The manual backend GitHub job is now a **verification-only operator
   handoff**: the protected `production-api` environment gates a check of the
   exact current main SHA, approved v3 manifest, and independently reviewed
   package checksum. It makes no production connection, uses no deployment
   secrets, and never performs deployment. The owner reports this environment
   has a required reviewer and main-only branch policy; self-review is allowed.
   Its approval permits this verification job only. A separate explicit owner
   decision is required before the operator executes the host script.

   The API firewall admits SSH from the privately verified operator IPv4 /32,
   not a standard GitHub-hosted runner. The smallest deployment transport is
   the existing key-only operator machine on that source, with strict existing
   known-host verification. The repository receipt confirms a previously
   pinned API host key, but does not store its fingerprint; the new GitHub
   `API_DO_SSH_KNOWN_HOSTS` secret was populated from the existing local pin
   without a fresh independent console comparison. Do not treat this as a new
   out-of-band host-key verification. Before execution, confirm the operator
   source still reaches the intended API Droplet and the privately held key
   still authenticates the privileged deployment login; stop if not. Do not
   broaden SSH ingress or install a runner on the production host.

   After the protected handoff succeeds and **separate deployment approval**
   is recorded, the operator fetches main, verifies its exact reviewed SHA,
   and streams `server/scripts/deploy-systemd-api.sh` from that immutable Git
   commit over strict SSH. Pass the same approved commit and package digest as
   arguments. The host script independently fetches current main, rebuilds
   and checks the package digest, verifies the restricted unit, and runs
   read-only preflights before stopping it. It uses `npm ci`, the restricted
   `chatforia-api` OS identity, the root-owned runtime EnvironmentFile,
   systemd preflights after installation, and narrow read access to tracked
   server files and dependencies without opening ignored secrets or uploads.
   It does not run SQL, use PM2, reset or clean the checkout, or change
   credentials. If installation fails after service stop, leave it stopped
   and follow the reviewed recovery procedure.
5. The voicemail dispatcher starts with the API, scans persisted due rows
   immediately, and recovers expired leases after restart. Do not start a new
   API worker against the pre-164 schema. Monitor PENDING, PROCESSING, FAILED,
   and SENT work; a fifth attempt with unknown outcome becomes FAILED for
   review. Confirm only the intended restricted systemd API process is active.

Provider acceptance before a crash or failed success-record transaction is
ambiguous: lease recovery can send the same email again. An in-flight provider
call longer than its five-minute lease can overlap another claim. This is
at-least-once, not exactly-once delivery; provider idempotency would be needed
for a stronger guarantee.

## Operator-source command boundary (future approved execution only)

Use a clean local checkout on the existing allowed operator source. Privately
select the direct API SSH host, the previously verified root login key, and its
strict known-host file. Confirm the successful protected handoff run records
the same full main commit and independently checked package digest, and that
the archived release package has that digest. In Bash with `pipefail` enabled,
fetch main, require `git rev-parse origin/main` to equal that commit, then
stream only `git show COMMIT:server/scripts/deploy-systemd-api.sh` to:

```text
ssh -i OPERATOR_KEY -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=PINNED_KNOWN_HOSTS \
  root@DIRECT_API_SSH_HOST bash -se -- COMMIT PACKAGE_SHA256
```

The source is the exact reviewed Git object, not a mutable local script.
`pipefail` makes a failed Git read fail the operator command. The host script
repeats the current-main and package checks before any service stop. Do not
execute this template under the present proposed v3 status or without the
separate production deployment authorization. If the operator source is no
longer admitted by the existing firewall, stop and review transport separately.

## Stop and recovery boundaries

Before migration SQL, a failed preflight leaves the schema unchanged. Keep
the approved traffic/writer fence until the operator confirms the previous
service and schema are compatible and separately authorizes reopening. Once
any migration SQL begins, a failed or partial attempt requires a privileged
read-only comparison of the package receipt, migration ledger, schema, and
preservation aggregates. Do not relabel failed ledger entries, run an
unreviewed down migration, or restart the old API merely because it still
starts. Resume forward only from a separately reviewed repair plan, or restore
the whole database from the verified backup under a separate recovery approval;
that restore may discard writes accepted after its recovery point.

If all 164 migrations pass but code installation or startup fails, keep the
listener stopped and traffic fenced. Inspect the systemd journal and final
runtime preflight, repair the compatible API forward, or use an expressly
reviewed code rollback only after proving it works with the 164-file schema.
Review any PROCESSING/FAILED voicemail outbox rows and the possibility of
duplicate mail before restarting workers. The manual workflow never performs
an automatic database or application rollback.

## Post-deployment checks still required

- Browser and physical Android/iOS SMS badge and visible-read behavior,
  including retry, reconnect, and cross-account isolation; Firefox remains
  outstanding. Verify quiet hours across the selected IANA zone, overnight
  spans, and daylight-saving transitions with live devices.
- Owned-mailbox receipt, correct destination/content, enabled and disabled
  voicemail forwarding, real signed Twilio recording/transcription callbacks,
  timing and retry behavior, duplicate callback handling, and authenticated
  playback from emailed links. No real provider traffic was used for local QA.
- Deployed attachment access and physical-device disappearing-message checks
  remain separate live-QA work.
