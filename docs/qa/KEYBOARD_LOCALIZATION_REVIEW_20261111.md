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

## Final integration review — November 12

- Read all 126 uncertainty-flagged entries against their English sources and final back-translations. Corrected 18 additional meaning or clarity errors in the isolated mobile branches. The most material were the inverted Kurmanji `may ignore` warning, a Central Atlas Tamazight warning that could read as `may allow`, categorical Hmong keyboard behavior, and `no hint` labels that read as `no light`, `no idea`, or `no notification`. Manual-switch, conversation-scope, and heading wording received targeted corrections. The original 15 non-English drafts and all other existing catalog values remain untouched.
- All 47 variant-sensitive entries have explicit per-variant notes in the mobile provenance. Simplified and Traditional Chinese retain distinct script/region resources. Kurmanji remains `kmr` on iOS and `ku` with `kmr`/`ku` native hints on Android, separate from Sorani `ckb`. Meitei retains `Mtei`; Norwegian uses the existing Bokmål resource; Dari uses the existing `fa-AF` resource. Generic Arabic, Punjabi, and Serbian choices do not force a keyboard script or region. The previously present iOS `pt-BR` and Android generic `pt` copies were not changed or conflated.
- After correction, structural validation accepted all 715 entries, the catalog audit found no pre-existing localization changes and all 715 provenance hashes matched, and importer tests passed 7/7. iOS simulator build/focused tests passed 8/8; Android resource/Kotlin compilation and full unit suite passed 301/301. Both runtime suites exercised the keyboard strings for every supported non-English menu choice and found no English fallback. The English menu choice intentionally uses the English source.
- Remaining linguistic review leads are the 126 explicitly flagged AI entries, especially Central Atlas Tamazight (`zgh`), Samoan (`sm`), Wolof (`wo`), Tok Pisin (`tpi`), and Dhivehi (`dv`). These are low-confidence phrasing or dialect questions; the current wording is not known to promise automatic keyboard switching. Fifteen older catalog drafts are also unreviewed. No professional signoff is claimed or required for integration of this nonblocking enhancement.
- Fetched `origin/main` remained at `33b478c6` (iOS), `7232c50f` (Android), and `56fe5d91` (main QA repository). The feature branches are based on those commits. Existing active QA branches have overlapping composer/catalog paths. The active iOS root has uncommitted localization changes to 12 unrelated keys; its keyboard keys are untouched. The active Android root has uncommitted Gradle and other unrelated work. Integration must use the clean isolated branches and preserve those active worktrees. A historical Android accessibility integration branch also has an unrelated `ChatsScreen.kt` three-way conflict, so it would need separate reconciliation if that branch is revived.

## Remaining verification

The 126 uncertain entries and the 15 earlier drafts are available for targeted community or fluent review without blocking critical launch QA. Physical-device checks still need installed keyboards, third-party Android IMEs, VoiceOver/TalkBack, manual switching, conversation changes, draft editing, and translation independence. A translated label does not guarantee that a native keyboard exists or honors a hint.
