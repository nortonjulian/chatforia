# Third-party notices audit — November 3, 2026

## Implemented

Production Vite builds emit third-party-notices.txt and third-party-notices.json from packages represented in emitted browser chunks, including transitive dependencies. The public Open Source Licenses page links to both. Package versions, declared license metadata, repository identifiers, and packaged LICENSE/COPYING/NOTICE/COPYRIGHT texts are preserved. Nested package entry-point manifests do not replace root package metadata. Build/server-only names were removed from the browser list.

This is an initial inventory, not a completed attribution review. The page labels native lists as an overview and distinguishes proprietary SDKs.

## Validation

Production client build passed. Inventory contains 90 packages. Fixture test covers scoped packages, nested transitive dependencies, entry-point manifests, duplicate modules, unused-package exclusion, preserved license/NOTICE text, and absent notices. git diff --check passed.

## Release blockers for complete license coverage

Eight browser packages did not ship license text in the installed package: @mantine/core, @mantine/dates, @mantine/hooks, @mantine/notifications, @mantine/store (8.3.5); html-parse-stringify (3.0.1); react-remove-scroll-bar (2.3.8); use-composed-ref (1.4.0). Retrieve and verify upstream notices at the exact release before treating this inventory as complete. The generated files disclose missing texts, and the build warns.

Separately audit static fonts, emoji/image data, externally loaded SDKs, and proprietary SDK distribution terms. Module inventory is not proof of coverage of these assets.

Native repositories were located and inspected: nortonjulian/chatforia-ios and nortonjulian/chatforia-android. iOS has a SwiftPM Package.resolved; Android uses Gradle version catalogs plus inline dependencies. Native release dependency resolution, complete license collection (including binary artifacts), bundled offline notices, and UI access remain outstanding. No native changes or successful native builds are claimed. Website notices cannot substitute for notices required in distributed native apps.

Do not automatically advance the policy date daily. Update the displayed notices revision only when its content changes; emitted package inventory follows the production build.
