# Footer content audit — November 3, 2026

Scope: Company, Support, Downloads, Legal. Plans & Pricing excluded by owner. This is a source/content audit, not a legal-compliance certification. Draft policy dates must match actual publication; do not roll dates forward automatically.

## Destination disposition

| Destination | Result |
| --- | --- |
| About | Added encryption transport and optional processing limitations. |
| How It Works | Removed username-only signup implication; clarified translation processing and accuracy. |
| Blog index and three articles | Routes present. Revised instant-delivery guarantee and translation limitations. Safety article reviewed; no additional copy change. |
| Careers | Future opportunities, not vacancies; existing résumé CTA and approved layout retained. |
| Press | Existing current kit, usage notes, and encryption limitations retained; user verified downloaded files. |
| Advertise | Configuration-based sizes and qualified availability retained; user verified inquiry #1 email delivery. |
| Getting Started | Clarified translation processing/strict encryption limitation; prior settings guidance retained. |
| Help Center | Added safe support-submission guidance; encryption/translation answers retained. |
| Safety | Reviewed; unchanged. Owner deferred explicit-content policy and setting reconciliation to final QA. |
| Contact Us | User verified ticket #1 in dashboard. Auto-resolved test proves persistence, not escalation quality. |
| Status Page | User verified Website/API monitors and public page previously; unchanged. |
| Downloads | Footer points directly to Apple/Google, /download uses go.chatforia.com redirects. Store availability remains unverified: Apple/redirect requests inaccessible from research tool; Google request returned 404. Not proof of a broken prelaunch listing. |
| Privacy | Corrected blanket E2EE claim, disclosed optional processing, advertising and additional data categories; linked privacy/deletion destinations. |
| Terms | Removed phone-provision-as-consent wording; separated SMS opt-out from app notification settings; fixed translated placeholder address. |
| Refund | Distinguished cancellation from refund, corrected Google developer-contact route, added platform links and statutory-rights qualification. |
| SMS | Correct LLC name, message frequency/rates, sending-number scope of STOP/START, recipient consent responsibility. |
| Cookie Settings | Removed false no-advertising-cookie assertion; accurately describes current information-only page. Functional preferences remain outstanding. |
| Do Not Sell / Share | Removed unsupported categorical no-sale assurance; explains mailto request and no immediate settings change. Functional opt-out remains outstanding. |
| Open Source Licenses | Layout improved. Current list is acknowledgments, not a complete set of versioned licenses/copyright notices. Completion remains outstanding. |

## Remaining issues requiring implementation or confirmation

1. **Advertising/analytics privacy controls:** `AdSenseAutoAds.jsx` injects third-party script without a local consent/GPC gate. `utils/analytics.js` initializes PostHog with autocapture/pageview when configured. No site-wide GPC handler was found in this review. A mailto or revised disclosure does not implement opt-out. Inventory all SDK entry points, choose applicable consent behavior and vendor configuration, then implement and test before treating these pages as finished. Do not claim existing browser-cookie controls stop all tracking.
2. **License notices:** reconcile exact shipped web, iOS, Android dependency versions and bundled SDK notices; distribute required license texts/attributions. Current names-only list is not sufficient evidence of license obligations being met. Native repositories were not audited in this pass.
3. **Refund/eSIM policy decision:** no new eligibility window or activation/consumed-data rule invented. Owner must approve eSIM cancellation/refund terms, then align purchase disclosure and operations.
4. **Privacy policy operational detail:** confirm real provider roles/configuration, retention periods and deletion schedules, international processing and jurisdiction-specific rights/processes before final legal sign-off. Draft copy does not certify these obligations fulfilled.
5. **Store release availability:** owner should confirm public versus test-only availability in both store consoles and test footer links with a non-tester account. Do not substitute test enrollment links for public store links without an explicit product decision.
6. **Support escalation:** test a request needing human review; one auto-resolved QA ticket does not validate escalation handling.
7. **Translations:** changed claims use fresh keys to prevent old catalog text from overriding corrections. Other locales fall back to English for these keys until reviewed translations are supplied.
8. **Publication date:** substantive Privacy/Terms/Refund/SMS changes use November 3, 2026 as the draft revision date; adjust to actual publication if released later. Layout-only license date remains unchanged.

## Evidence and sources

- `server/services/messageService.js`: explicit-content preference gates profanity cleanup.
- `server/middleware/blockWhenStrictE2EE.js`, Help Center: strict mode excludes optional processing.
- `server/prisma/schema.prisma`: account/contact/device/billing/support/SMS/consent records.
- `server/routes/smsWebhooks.js`: STOP/START/HELP handling; consent form separately requests consent.
- `client/src/ads/AdSenseAutoAds.jsx`, `client/src/utils/analytics.js`: advertising/analytics integrations.
- California AG: https://oag.ca.gov/privacy/ccpa and https://oag.ca.gov/privacy/ccpa/gpc (covered-business opt-out/GPC obligations; applicability still needs confirmation).
- Twilio messaging policy: https://www.twilio.com/en-us/legal/messaging-policy (recipient consent and revocation).
- Apple refunds: https://support.apple.com/118223 and https://reportaproblem.apple.com/
- Google refunds: https://support.google.com/googleplay/answer/2479637 (platform and developer assistance).

## Verification

Production build passed after substantive copy revisions. Existing footer/layout/Advertise tests are run separately; these do not prove legal compliance or live vendor consent behavior. Prior user-confirmed mobile, contact storage, ad email, and Press download checks remain valid for their tested scope.

Owner decision: explicit-content review is deferred to final QA; no Safety copy changes are included.
