# Third-party notices audit — November 3, 2026

## Implemented

Production Vite builds emit third-party-notices.txt and third-party-notices.json from packages represented in emitted browser chunks, including transitive dependencies. The public Open Source Licenses page links to both. Package versions, declared license metadata, repository identifiers, and packaged LICENSE/COPYING/NOTICE/COPYRIGHT texts are preserved. Nested package entry-point manifests do not replace root package metadata. Build/server-only names were removed from the browser list.

This is an initial inventory, not a completed attribution review. The page labels native lists as an overview and distinguishes proprietary SDKs.

## Validation

Production client build passed. Inventory contains 90 packages. Fixture test covers scoped packages, nested transitive dependencies, entry-point manifests, duplicate modules, unused-package exclusion, preserved license/NOTICE text, and absent notices. git diff --check passed.

## Release blockers for complete license coverage

Five Mantine 8.3.5 packages now use the exact upstream release LICENSE, copied byte-for-byte from commit 014ef1dac11b025d8a12e2f24a0036da9119a562 (tag 8.3.5). Supplement entries are keyed by exact package version and checked by SHA-256; upstream source URLs are included in both outputs. An upgrade cannot silently reuse an older supplement.

Two further notices were recovered:

- html-parse-stringify 3.0.1: upstream added LICENSE at a2659e6eac3603ba8b46958e0bd35b337108261f while package.json still reported 3.0.1. `git diff` between release 05d41c55888a951e27b232cbaf4e432b41da3b65 and that commit for src/ and lib/ is empty. The complete notice is copied with its actual source commit.
- react-remove-scroll-bar 2.3.8: the published 2.3.7 tarball and installed 2.3.8 package have byte-identical dist/ and constants/ directories (`diff -qr` passed). Upstream added LICENSE at 7301c160fda44cb8cf2b9fdfde61efad35736196 while package.json reported 2.3.7, with only LICENSE changed in that commit. Preserve that notice for the unchanged distributed code; do not describe the commit as the 2.3.8 release tag. The npm gitHead remains unavailable.

One upstream gap remains: use-composed-ref 1.4.0, pinned tag v1.4.0 at ea2c9d969f2f90a349f4c99338b806423824cea2, declares MIT but contains no full license/copyright notice. The current default-branch tree also lacks one. No copyright holder/year has been invented. Upstream clarification is needed for a verified notice. The generator continues to disclose this gap and warn; it is not silently marked complete.

Separately audit static fonts, emoji/image data, externally loaded SDKs, and proprietary SDK distribution terms. Module inventory is not proof of coverage of these assets.

Native repositories were located and inspected: nortonjulian/chatforia-ios and nortonjulian/chatforia-android. iOS has a SwiftPM Package.resolved; Android uses Gradle version catalogs plus inline dependencies. Native release dependency resolution, complete license collection (including binary artifacts), bundled offline notices, and UI access remain outstanding. No native changes or successful native builds are claimed. Website notices cannot substitute for notices required in distributed native apps.

Do not automatically advance the policy date daily. Update the displayed notices revision only when its content changes; emitted package inventory follows the production build.

Follow-up validation: two Node tests passed (including exact-version supplements, checksum failure, and preserved source provenance); production build passed with 90 packages, 87 containing license/notice text, three disclosed gaps. Native code remains unchanged.

Latest validation: production client build and both Node tests passed; 89 of 90 browser packages contain preserved license/notice text. iOS source-notice collection and offline viewer are being handled in the native repository; binary SDK review and native build validation remain separate.
