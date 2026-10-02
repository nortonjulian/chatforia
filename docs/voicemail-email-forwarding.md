# Voicemail email forwarding

Voicemail availability and email delivery are independent preferences:

- `voicemailEnabled`: whether callers can leave a voicemail; editable on the website.
- `voicemailEmailForwardingEnabled`: explicit opt-in for email delivery.
- `voicemailForwardEmail`: saved destination, retained when email forwarding is switched off.
- `canForwardVoicemailEmail`: server-derived entitlement used by all clients. Eligible plans follow the existing paid forwarding policy: PLUS, PREMIUM, WIRELESS.

Delivery requires an eligible current database plan, an enabled email preference, and a valid saved address. A downgrade pauses email delivery while preserving preferences. Basic voicemail storage, transcription scheduling, and inbox events remain independent. An upgrade resumes delivery if the saved preference is still enabled.

## Rollout order

1. Review and merge the backend/website PR. Apply migration `20261002213000_voicemail_email_forwarding_control` to the production database and regenerate Prisma Client before restarting the API. Follow the deployment's existing database/environment procedure; tests never apply this migration to production.
2. Verify `/auth/me` and settings responses include both new booleans. Verify a paid account can enable/disable email delivery without changing the website voicemail availability setting.
3. Release the matching iOS PR #20 and Android email-forwarding-control PR after their builds and device checks pass.

The migration retains existing configured email forwarding for paid accounts. New accounts default off. Free accounts with saved addresses stay off. Legacy clients can update an address but cannot implicitly enable delivery; clearing an address disables forwarding. Old iOS releases with the mislabeled voicemail-availability switch must be updated; the backend cannot distinguish a deliberate availability change from an old mislabeled control.

## Verification

Backend focused suites: users, voicemailForwarding, voicemailForwardingWebhook, voiceWebhooks, voicemail, voicemailEmail. Test enabled paid delivery, disabled delivery with address retained, Free-plan delivery suppression, missing/invalid destination validation, legacy address-only saves, and storage/inbox events regardless of email forwarding.

Website: build and paid/Free settings checks. Keep the website Enable voicemail switch independent.

iOS: build the Chatforia scheme, run VoicemailEmailSettingsTests, and verify the true forwarding switch plus address, retention, and greeting persistence on device. Saving app settings must omit `voicemailEnabled`.

Android: assembleDebug and run SettingsViewModelTest and SettingsRepositoryTest. Verify the same behavior on device, including saving other settings while on Free. These clients omit unavailable paid preferences rather than clearing them during unrelated saves.

End-to-end: with voicemail enabled, leave an audible voicemail after decline and ring-out. Confirm inbox delivery in both cases, email delivery with forwarding on, and no email with it off. Confirm phone-number and calling regressions separately before release.
