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
   pass. The manual backend workflow requires the exact main SHA, package
   checksum, an approved v3 manifest, a protected `production-api` environment,
   pinned `API_DO_SSH_KNOWN_HOSTS`, and existing SSH identity/host/user secrets.
   It uses `npm ci`, the restricted `chatforia-api` OS identity, the root-owned
   runtime EnvironmentFile, systemd runtime preflights before stop and after
   installation, and narrow read access to tracked server files and installed
   dependencies without opening ignored secrets or upload trees. It uses
   `chatforia-api.service`. It does not run SQL, use PM2, reset or clean the
   checkout, or change credentials. If installation fails after service stop,
   leave the service stopped and follow the reviewed operator recovery procedure.
   Before any dispatch, independently confirm GitHub Settings → Environments
   contains `production-api` with required reviewer protection and a main-only
   deployment branch rule. Merely naming an absent environment in a workflow
   can create it without those rules. Confirm the four required SSH secret
   names are configured, including a privileged deployment-only SSH identity;
   compare the pinned known-host key fingerprint with a
   trusted host record without printing the key or secret values. Repository
   API access for this review did not expose those settings.
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
