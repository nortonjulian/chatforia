# Temporary teen visual-media restriction — review handoff

This branch applies a temporary server rule while a full Sensitive Media Protection design remains unimplemented. It has no date-based expiry. Removing or relaxing it requires an explicit product and security approval, a reviewed code change, and new tests. Do not treat a client control as enforcement.

## Scope

- A room with any current teen participant rejects new image, video, and GIF message attachments, whether sent by a teen or adult. This includes direct, group, and Random Chat rooms, edited messages, and forwarding from or into a teen room.
- Historical visual attachments are omitted from message history, deltas, real-time per-recipient payloads, conversation previews, and room galleries. Private media grants and downloads recheck the current viewer, sender, and room membership. Ordinary text and nonvisual attachments remain available.
- Teen accounts cannot upload visual media through `/media/upload` or the generic `/uploads` and presigned-intent paths. The completion and owner-download paths recheck the current age band. Adult uploads remain available.
- Carrier MMS is handled separately: teen outbound MMS is rejected before provider or persistence effects. Inbound MMS is still received and stored for history/reporting, but teen API and socket responses withhold visual and unknown legacy media entries; the authenticated media proxy denies fetching them. Text and known audio entries remain visible. SMS push and forwarding carry text, not media URLs.
- The API returns `TEEN_VISUAL_MEDIA_RESTRICTED` for attempted sends. The iOS branch shows a localized explanation and a restricted-media placeholder when the API returns `mediaRestricted`.

## Required checks before release

1. Verify the deployed object store and CDN are private for message media, and that old public URLs or cached objects cannot still serve historical visual bytes. Application redaction cannot revoke a URL that remains publicly readable. Do not claim historical-media protection until this is demonstrated or an explicitly approved exception is recorded.
2. Resolve the age-band trust rule. `server/routes/users.js` currently lets an authenticated user change `ageBand` to an adult value by self-attestation. A teen can thereby evade the rule. A separate age-transition policy and enforcement change is required; this branch does not invent an age-verification process.
3. Review metadata attestation. Message attachment kind, MIME, filename, and storage content type can be supplied by a client. A malicious client may label visual bytes as a nonvisual type. The server does not decrypt E2EE media and cannot classify it from encrypted content. Decide whether to require stronger upload-type proof or a broader temporary attachment restriction; the latter would affect audio/docs and needs explicit approval.
4. Confirm production MMS media URLs have no separate public path that bypasses `/sms/media/:messageId/:idx`. The carrier has already received external MMS before Chatforia can filter it; the app cannot prevent sender-side carrier delivery.
5. Ship iOS handling with the backend and complete Android parity. The existing Android dirty worktree was inspected read-only and does not yet consume `mediaRestricted` or show the restriction error. Verify push payloads and local thumbnail caches on devices.
6. Review localization. The iOS explanation has authored entries for 14 locales; other supported app locales currently fall back to English. This is not full localization coverage.

No stored customer media or historical message is deleted. No migration or new moderation provider is introduced. This branch depends on the separate reporting/blocking branch at `c18066d2`; the iOS branch similarly depends on `6cd8f3a`.
