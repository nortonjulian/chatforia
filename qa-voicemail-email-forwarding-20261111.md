# Voicemail email forwarding local QA — 2026-11-11

Base: `origin/main` at `dbf5887e`. This branch is isolated from the SMS/quiet-hours PR #323 and the completed staff-security release.

## Reused evidence and current local checks

- The existing settings, forwarding gate, voicemail audio, and email tests cover paid-plan opt-in, disabled/free-plan suppression, address retention, and authenticated audio proxying. The earlier unmerged `160b16a5` and `52a26de9` provider-result fix/tests were preserved on this branch.
- New synthetic callback tests cover a delayed completed recording, one notification on sequential duplicate callbacks, one local mail retry after a failed result, rejection of missing recording SID before side effects, storage failure, and a conflicting account/SID. A delayed transcription does not resend email; the email is an inbox notification and the later transcript remains in the app.
- Rendered web profile component tests with mocked Mantine controls cover save/reopen, account switching, and disabled controls for an ineligible plan. They are automated UI tests, not a browser observation.
- The email content tests verify the configured recipient, escaped HTML content, an authenticated inbox link, and absence of the provider recording URL. The existing audio route test verifies another account cannot fetch the recording.
- Local backend Jest: 4 suites, 80 tests passed, followed by the affected callback suite with its added overlapping-delivery case: 12 tests passed. Local web component Jest: 1 suite, 2 tests passed. Backend changed-file ESLint had no errors. Full `UserProfile.jsx` ESLint still reports the two pre-existing undefined `doFollow`/`doUnfollow` references outside this change.

## Delivery limits and live checks

Twilio documents `RecordingSid` on `<Record>` recording status callbacks. It also documents a 15-second upper bound on voice HTTP requests and a default connection-override retry policy of `ct`, not `5xx` ([callback fields](https://www.twilio.com/docs/voice/twiml/record), [retry policy](https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides)). The callback retains its original immediate HTTP acknowledgment, so audio analysis and mail run afterward. The new in-process mail path makes one short retry after a rejected submission and suppresses concurrent duplicate sends within one API process. A crash or a longer mail outage still loses the background attempt; Twilio will not retry an already acknowledged callback. Provider acceptance does not prove delivery into the recipient inbox.

Sequential retries after a confirmed send are suppressed using `forwardedToEmailAt`. Concurrent callbacks across multiple API processes, a crash after provider acceptance but before that timestamp is stored, and legacy voicemails saved before deterministic `RecordingSid` IDs remain at-least-once/duplicate risks. A storage failure after acknowledgment is logged but is not retried. Reliable eventual retry and cross-process deduplication require a durable delivery queue or outbox and a separate release design; this branch does not claim them.

Before release, verify with real Twilio and an owned test mailbox: recording callback signature and timing; enabled/disabled delivery; delayed transcription; duplicate callback behavior; mail provider rejection and retry policy; authenticated playback after the email link; and account isolation. No real provider or recipient was contacted in this QA pass.

PR #323 remains separate: its 163-migration package, historical preflight/rehearsal compatibility, and replacement systemd-compatible backend deployment workflow are still release prerequisites. Do not weaken the pinned 160/161 checks.
