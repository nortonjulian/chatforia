# Third-party notices audit — November 3, 2026

## Implemented

Production Vite builds emit third-party-notices.txt and third-party-notices.json from packages represented in emitted browser chunks, including transitive dependencies. The public Open Source Licenses page links to both. Package versions, declared license metadata, repository identifiers, and packaged LICENSE/COPYING/NOTICE/COPYRIGHT texts are preserved. Nested package entry-point manifests do not replace root package metadata. Build/server-only names were removed from the browser list.

This is an initial inventory, not a completed attribution review. The page labels native lists as an overview and distinguishes proprietary SDKs.

## Validation

Production client build passed. Inventory contains 90 packages. Fixture test covers scoped packages, nested transitive dependencies, entry-point manifests, duplicate modules, unused-package exclusion, preserved license/NOTICE text, and absent notices. git diff --check passed.

## Release blockers for complete license coverage

Five Mantine 8.3.5 packages now use the exact upstream release LICENSE, copied byte-for-byte from commit 014ef1dac11b025d8a12e2f24a0036da9119a562 (tag 8.3.5). Supplement entries are keyed by exact package version and checked by SHA-256; upstream source URLs are included in both outputs. An upgrade cannot silently reuse an older supplement.

Three packages remain unresolved:

- html-parse-stringify 3.0.1: tag v3.0.1 resolves to 05d41c55888a951e27b232cbaf4e432b41da3b65. Package metadata and README declare MIT, but the tagged tree has no full license/copyright notice.
- use-composed-ref 1.4.0: tag v1.4.0 resolves to ea2c9d969f2f90a349f4c99338b806423824cea2. Metadata declares MIT, but the tagged tree has no full license/copyright notice.
- react-remove-scroll-bar 2.3.8: npm reports gitHead b3b1287aad81def2e2ae707274b74531b61ddbaf, but upstream rejects that ref. No matching version tag was found. Current upstream has LICENSE added at 7301c160fda44cb8cf2b9fdfde61efad35736196; it is not copied as an exact-release notice without establishing applicability.

The generated files disclose these three missing texts and the build warns. Upstream clarification or another verified source is needed; no copyright holder/year is invented. Do not claim complete attribution coverage.

Separately audit static fonts, emoji/image data, externally loaded SDKs, and proprietary SDK distribution terms. Module inventory is not proof of coverage of these assets.

Native repositories were located and inspected: nortonjulian/chatforia-ios and nortonjulian/chatforia-android. iOS has a SwiftPM Package.resolved; Android uses Gradle version catalogs plus inline dependencies. Native release dependency resolution, complete license collection (including binary artifacts), bundled offline notices, and UI access remain outstanding. No native changes or successful native builds are claimed. Website notices cannot substitute for notices required in distributed native apps.

Do not automatically advance the policy date daily. Update the displayed notices revision only when its content changes; emitted package inventory follows the production build.

Follow-up validation: two Node tests passed (including exact-version supplements, checksum failure, and preserved source provenance); production build passed with 90 packages, 87 containing license/notice text, three disclosed gaps. Native code remains unchanged.
