# Chatforia final launch QA index

This index begins on 2026-11-11 because no standalone launch checklist was found in the main, iOS, or Android repositories. Existing QA conversations, receipts, and signoffs remain authoritative for work already completed. An item absent here is **not** presumed untested or failed. Confirm its status against its original record before changing a launch decision.

## Priority and recorded evidence

| Area | Status supported by current evidence | Source / next confirmation |
| --- | --- | --- |
| Staff security Stage 5 recovery and Stage 6 founder-only rollout | Completed November 10; preserve signoffs and recovery artifacts | Existing staff-security receipts and owner record; no retest implied here |
| SMS read receipts, quiet-hours zone, voicemail outbox | Local and disposable PostgreSQL 18 checks recorded; live cross-platform/provider QA is separate | `docs/application-release-164-20261111.md` and `qa-voicemail-email-forwarding-20261111.md` |
| Final release package and encrypted backup | Verified for main commit `56fe5d914231b21608e6ba511daa0088efc501b7` in the release session | Existing package and backup verification receipts; no backup recreation implied |
| Remaining critical launch QA | Confirm current status from the owning QA/release records before scheduling | Browser/Firefox, physical-device SMS and disappearing messages, deployed attachment access, real forwarding and voicemail providers are listed in `docs/application-release-164-20261111.md` |

## Hybrid Keyboard-Language Integration — iOS and Android

**Priority: nonblocking prelaunch enhancement.** Continue critical launch QA even if this enhancement remains under review or device verification.

- Separate typing-language choices from app display language and message translation preferences. Default to system keyboard behavior. Scope a saved choice to the signed-in account and conversation; do not infer language from message content or contacts.
- iOS: use a stable UIKit `textInputContextIdentifier` for each conversation so the system can remember a keyboard selected manually. A language choice creates a separate memory context; it does not select or force a keyboard.
- Android: send the explicit choice through Compose `KeyboardOptions.hintLocales`/`EditorInfo.hintLocales`. Clear the hint for system behavior. The active IME may ignore the hint.
- Automated checks: preference persistence and account/conversation isolation; choice changes and clearing; distinct context/hints when switching conversations; composer typing, clearing, multiline/send behavior; app-language and translation independence.
- **Physical-device verification still required:** with at least two installed keyboards, switch languages manually in two conversations, leave/reopen each, and confirm keyboard behavior without a forced switch. Check a third-party Android IME, hardware keyboard, accessibility labels and VoiceOver/TalkBack, draft editing/selection, attachment caption, and send stability. Record the keyboard/OS versions and whether each IME honored the hint; do not describe best-effort behavior as guaranteed automatic switching.

Current status: isolated local implementation complete, pending review and physical-device verification. Focused Android Robolectric tests passed (4/4) and iOS simulator XCTest passed (4/4); these check storage isolation, clearing/system behavior, context changes, draft/delegate stability, and app-language independence. They do **not** prove that a particular keyboard honors a hint or that the complete composer UI works on every device. No merge, publication, deployment, or production change is authorized by this checklist.
