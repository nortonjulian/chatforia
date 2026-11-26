# Velvet outgoing text contrast proposal — pending owner visual approval

This is a local website proposal only. It has **not** been pushed to PR #354 or approved for release. The existing approved Velvet `135deg` `#FF2D7A` → `#FFD84D` outgoing gradient, dark backgrounds, bubble shapes, white microphone and white CTA labels are unchanged. Only outgoing bubble text changes to `#241031`, a deep plum already present in the Velvet card token; the bubble text shadow is removed and the edited indicator is no longer dimmed. Captions remain white on the dark chat surface. Outgoing MMS captions remain white on their transparent dark surface.

The alternative burgundy `#451033` reached only about **4.30:1** at the pink stop, below the 4.5:1 normal-text target. The selected deep plum reaches at least **4.946:1** on the rendered gradient. A darker existing Velvet background color `#17071C` would have reached about **5.45:1**, but the selected card color is closer to the existing design while passing the target.

## Authenticated browser measurements

The screenshots use the existing disposable localhost accounts and native message fixtures, with Velvet selected only in the browser QA context. Measurements sampled every pixel of a rendered 400 × 200 CSS gradient panel (80,000 background samples), then compared the actual computed text colors and opacities. The same results were recorded at 1280 × 800 and 390 × 844 in both light and dark system appearances. This is browser evidence, not physical-device or owner visual approval.

| Element | Before | Proposed | Background |
| --- | ---: | ---: | --- |
| Outgoing native message text, minimum over gradient | 1.383:1 | 4.946:1 | Unchanged Velvet pink-to-gold gradient |
| Edited indicator, minimum over gradient | 1.314:1 | 4.946:1 | Same gradient; proposed full opacity |
| White media caption | 16.339:1 | 16.339:1 | Velvet dark chat surface `#17071C` |
| `Seen` metadata | Not measured in baseline capture | 10.569:1 | Velvet dark chat surface `#17071C` |

Selected rendered gradient samples for the proposed text: pink side `#FF2E7A` **4.963:1**; intermediate `#FF586E` **5.759:1**, `#FF8263` **7.227:1**, `#FFAD58` **9.527:1**; gold side `#FFD74D` **12.635:1**. The global minimum across all samples was **4.946:1**. The unchanged white microphone token is `#FFFFFF`. A separate authenticated SMS/MMS browser check altered only two existing test messages' direction in an intercepted response, with no database write or carrier send; actual React rendering showed deep-plum outgoing SMS text and a white outgoing MMS caption on a transparent surface (`sms-report.json`).

## Screenshot pairs

| Appearance and width | Before bubble | Proposed bubble | Before caption | Proposed caption |
| --- | --- | --- | --- | --- |
| Light 1280px | `before-1280-light-bubble.png` | `after-1280-light-bubble.png` | `before-1280-light-caption.png` | `after-1280-light-caption.png` |
| Dark 1280px | `before-1280-dark-bubble.png` | `after-1280-dark-bubble.png` | `before-1280-dark-caption.png` | `after-1280-dark-caption.png` |
| Light 390px | `before-390-light-bubble.png` | `after-390-light-bubble.png` | `before-390-light-caption.png` | `after-390-light-caption.png` |
| Dark 390px | `before-390-dark-bubble.png` | `after-390-dark-bubble.png` | `before-390-dark-caption.png` | `after-390-dark-caption.png` |

`after-390-light-sms.png` shows the SMS/MMS text and caption browser check. `before-report.json`, `after-report.json`, and `sms-report.json` contain the computed colors and measurements. `capture.mjs` and `check-sms.mjs` are local-only reproducibility scripts; they read disposable secrets from the existing `/private/tmp` fixture and never write them to this evidence directory.

## Verification and visual decision

The focused theme, native message, and SMS reporting suites passed **33/33 tests**. After adding the final SMS caption selector assertion, the focused theme suite passed **14/14** again. The production web build passed (9,864 modules, 4.67 seconds). The visual tradeoff is a dark plum foreground on the unchanged bright gradient, replacing the previously approved white outgoing text. Owner visual approval is required before this local proposal may be added to PR #354. The seven other themes and their tokens are unchanged.
