# Hybrid keyboard localization review — 2026-11-11

This is a local, nonblocking launch enhancement. No mobile feature branch has been pushed or merged.

## Coverage and preservation

- Five new English source strings: three iOS, two Android. The supported menus each contain 147 choices, including English.
- 715 previously absent translations were added: 429 iOS and 286 Android. Fifteen earlier Spanish, French, and Portuguese draft translations remain byte-for-byte unchanged. No other existing localization value was changed.
- The new entries are AI-generated and **linguistically unreviewed**. Their status, per-entry hashes, and uncertainty flags are stored in `docs/qa/KEYBOARD_AI_TRANSLATIONS.json` in each mobile feature branch. iOS catalogs use `needs_review`; Android entries carry unreviewed comments.
- The Android app needed six exact keyboard-string copies under legacy resource qualifiers for Hebrew (`iw`), Indonesian (`in`), and Yiddish (`ji`). This corrects runtime resource selection without changing language choices, keyboard hints, app-language settings, or translation preferences.

## Validation performed

- Original 715-target batch: exact source hashes, language identifiers, locale/resource paths, protected literal `iOS`, placeholder sets, Unicode NFC, nonblank translations, and rejection of identical English fallback. Import refused dirty or stale target branches and existing catalog values. Unit tests: 7/7.
- Second-pass script flagged 126 entries for uncertainty; 47 are variant-sensitive and 66 contain possible English loanwords (overlapping sets). Back-translations were inspected for the original 122 risk-flagged entries and 50 fixed-sample entries. Twelve meaning corrections were applied. These checks are useful screening, not fluent native-speaker signoff.
- Catalog audit: 429 iOS and 286 Android additions, six alias copies, 458,652 existing iOS localization values preserved, all existing Android string values preserved, and all 715 new translation hashes matched provenance.
- iOS simulator app build and focused XCTest: 8/8 passed, including lookup for all three strings in every non-English menu choice. Android Kotlin/resource compilation and full unit suite: 301/301 passed, including both new strings for every non-English choice.

## Remaining verification

The 126 uncertain entries and the 15 earlier drafts are available for targeted community or fluent review without blocking critical launch QA. Physical-device checks still need installed keyboards, third-party Android IMEs, VoiceOver/TalkBack, manual switching, conversation changes, draft editing, and translation independence. A translated label does not guarantee that a native keyboard exists or honors a hint.
