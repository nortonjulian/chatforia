# Chatforia final launch QA index

This index begins on 2026-11-11 because no standalone launch checklist was found in the main, iOS, or Android repositories. Existing QA conversations, receipts, and signoffs remain authoritative for work already completed. An item absent here is **not** presumed untested or failed. Confirm its status against its original record before changing a launch decision.

The linked release documents are snapshots of QA evidence. Use later owner approval and execution receipts for current release status; this index does not supersede them.

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
- Focused automated checks: preference persistence and account/conversation isolation; choice changes and clearing; distinct context/hints when switching conversations; draft/delegate binding; app-language independence. Complete composer multiline/send and translation UI behavior still need hands-on checks.
- Localization review: the menu reuses existing translated language names for all 147 choices, with system-locale fallbacks for missing catalog names. The three new iOS and two new Android guidance keys have draft Spanish, French, and Portuguese copy, but those 15 non-English entries have not received language review. Another 715 target entries are untranslated across the two platforms (143 menu locales per key) and currently fall back to English. A provider-independent translation batch is prepared separately; no DeepL call is part of this work. Supply and review the missing translations before calling the enhancement fully localized. Keep it deferred if that review would delay critical launch QA.
- **Physical-device verification still required:** with at least two installed keyboards, switch languages manually in two conversations, leave/reopen each, and confirm keyboard behavior without a forced switch. Check a third-party Android IME, hardware keyboard, accessibility labels and VoiceOver/TalkBack, draft editing/selection, attachment caption, and send stability. Record the keyboard/OS versions and whether each IME honored the hint; do not describe best-effort behavior as guaranteed automatic switching.

### Supported-language audit, November 11

- The iOS `AppLanguages.all` and Android `LANGUAGES` menus each contain 147 distinct choices. Focused tests iterate every choice: iOS preserves 147 distinct conversation context identifiers; Android persists every choice and produces a parseable IME locale tag. Unsupported saved codes produce no Android hint or an iOS system context. Mixed case and underscores normalize to each platform's menu code.
- Android sends script-first hints for `zh-CN`/`zh-TW` (`zh-Hans-CN`/`zh-Hant-TW`) with the region tags as fallbacks; `ku` (labeled Kurmanji) sends `kmr` then `ku`; `no` sends `nb` then `no`, matching the existing app-locale choice. `mni-Mtei` keeps its script. Android `pt` remains generic and rejects `pt-BR` as an unsupported menu choice; iOS `pt-BR` remains Brazilian and does not accept generic `pt`. Do not silently equate those Portuguese choices.
- Source localization assets use additional aliases: the built iOS string catalog has `ku`/`fil` but no exact `kmr`/`tl`; Android resources have `values-kmr`, `values-nb`, and `values-fa-rAF` but no exact `values-ku`, `values-no`, or `values-prs`. Android also uses generic `values-mni` for menu code `mni-Mtei`. The Android app-locale helper maps `no`, `prs`, and `mni-Mtei` to those resources, but has no explicit `ku` mapping. Review these display-language/resource mappings separately; the keyboard hint preserves `mni-Mtei` and does not alter app or message translation preferences.
- A parseable tag or distinct context does **not** establish an installed keyboard, its writing-system variant, or IME compliance. Generic choices such as `sr`, `pa`, and `ar` do not select a script or region; the user remains in control of the keyboard.

Current status: isolated local implementation complete; localization review and physical-device verification remain outstanding. The Android unit suite passed (300/300) before the subsequent accessibility-name-only change; its affected focused tests passed again (8/8) with Kotlin compilation. iOS simulator XCTest passed again (7/7) with the app test build. These checks cover all menu codes, localized display names, storage isolation, clearing/system behavior, context changes, draft/delegate stability, and app-language independence. They do **not** prove that a particular keyboard honors a hint or that the complete composer UI works on every device. No merge, publication, deployment, or production change is authorized by this checklist.
