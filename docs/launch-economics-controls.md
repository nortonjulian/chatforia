# Launch economics controls — review draft, 8 November 2026

> Launch decision — November 9, 2026: affiliate compensation is deferred. Use the no-commission baseline. The creator pilot offers an agreed, time-limited Premium comp and one 3GB data pack in exchange for honestly disclosed content, with tracking but no commissions or automatic renewals. The historical pricing/package scenarios below are retained for reference, not launch instructions or approved prices. Run scripts with `--include-affiliate-scenario` only for future affiliate sensitivity analysis. See `creator-pilot.md` for implementation and rollout.

This branch builds on translation PR #309. It is not a production rollout or a final commercial offer. No prices, SMS allowances, paid top-ups, affiliate payments or eSIM rates have been changed. There are no new database migrations.

## Implemented draft behavior

- Rewrites, smart replies, personal Ria chat, Random Chat Ria, explicit group Ria and thread summaries consume the existing shared `riaActions` allowance: Free 20, Plus 200, Premium 500 per UTC month. Existing feature eligibility still applies. Group invocations retain their permanent source-message claim, so exhausted or failed invocations are not automatically retried.
- Failed AI operations release their reservation in its original month, including across midnight. Input text sent to AI is limited to 32,768 UTF-8 bytes. Output limits remain 120/180/200/220/400 tokens by feature. Provider clients have no automatic retries and a finite timeout.
- Premium voice-note transcription has a proposed 120-minute monthly budget; Free/Plus retain the configured existing free budget (default 20 minutes). This is separate from the 30-minute Premium voicemail budget. This is a material change from previously unbounded Premium voice notes and must be disclosed before rollout.
- Audio is downloaded through the existing authorized media path, probed locally and rounded up to seconds before the atomic usage reservation. Untrusted attachment duration is not used as the billable quantity. Unknown duration fails before any transcription-provider call.
- Saved transcripts are returned before reservation. Provider failures refund reservations. Quota responses include the limit and UTC reset date. Accessibility preferences, no-store behavior and post-provider authorization checks remain in place.
- Translation refunds are pinned to the reservation month. PR #309's cache/no-op and duplicate-work fixes remain intact.

## Validation

Focused checks: 141 tests passed across 19 suites. PostgreSQL checks: 6 tests passed across 2 suites. The focused PostgreSQL invocation does not meet the repository-wide coverage thresholds because it runs only those two suites; full-suite coverage is not claimed. Targeted ESLint reported no errors (existing style warnings remain).

A disposable local PostgreSQL 18.6 cluster, with synthetic users and no production connection, was used. All 161 existing migrations applied after provisioning the repository's required restricted staff roles/schema. The migration SQL was not edited. PostgreSQL integration checks cover competing translation reservations, cache access at exhaustion, provider-failure refunds, competing shared-AI reservations, competing measured Premium transcription reservations, and the existing positive group-Ria HTTP/reconnect test. Providers are mocked; no paid API requests were made.

The audio-duration test probes an actual generated 1.1-second WAV and verifies rounding to two seconds and rejection of malformed audio. Focused route/service tests cover authorization, consent, cached transcripts, failed refunds, quota errors, multibyte AI input, GSM-7/UCS-2 segmentation and independently rounded voice legs.

This does not replace full deployment QA against the production PostgreSQL version, actual provider accounts, or web/iOS/Android clients.

## Telecom accounting: calculations, not new customer charges

`server/services/economics/telecomCosting.js` models GSM-7 extended characters, Unicode, multipart messages, the US/Canada toll-free payload exception, separate MMS rates, explicit carrier fees and each connected voice leg rounded separately. Unknown rates are rejected rather than silently treated as zero. These are estimates; smart encoding and actual provider records can differ.

The runtime still counts SMS/MMS messages as before. It has NOT been relabeled as segment credits. Carrier-cost reconciliation, including rejected inbound traffic and forwarding that is not stored as an ordinary outbound message, remains required before claiming a monetary ceiling. Existing inbound quota behavior can withhold delivery even though a carrier charge already occurred. This draft does not claim to solve that billing/delivery policy.

A prepaid telecom wallet is not implemented and must not be advertised. eSIM top-ups do not constitute a voice/SMS wallet.

## Reproducible stress model

Run `node server/scripts/plan-economics.mjs` to print the assumptions, itemized costs and channel-specific contributions. It is offline and does not read production data. Scenarios are 25%, 50%, and 100% of all included quantities, plus multipart/large-prompt stress. They are not measured customer percentiles or forecasts.

Assumptions: one $1.15 US local number, $20/million translated characters, $0.004 video participant-minute, $0.0083 SMS base plus an assumed $0.0045 carrier fee, 10% outbound MMS at $0.022 plus assumed $0.01 carrier fee, $0.018 app-to-PSTN minute, $0.0225 two-leg forwarded PSTN minute. Rates are illustrative US local routes, not all NANP destinations; Alaska and international destinations can be much higher. The voice examples assume whole-minute connected calls; shorter calls can produce more rounding overhead.

AI uses $0.40/$1.60 per million input/output tokens for the more expensive hardcoded Random Chat model, gpt-4.1-mini, rather than incorrectly applying gpt-4o-mini's $0.15/$0.60 to every path. The normal scenario assumes 8,000 input tokens/action; stress assumes 35,000 including an overhead allowance, with 400 output tokens/action. This is a scenario, not a proven tokenizer bound or an invoice maximum. An OPENAI_MODEL override requires repricing. Transcription uses an estimated $0.006/minute; it is token-billed. Storage reserves of $0.50/$1.00 are assumptions, not measured quotes.

Stripe subscriptions use the account's 2.9% + $0.30 processing plus 0.7% Billing. The store scenario uses 15%; verify actual store eligibility and transaction treatment. Stripe and store fees are never stacked. The proposed affiliate scenario deducts 20% of receipts after channel fees. Annual Premium revenue is spread over 12 months while monthly usage limits remain unchanged.

Exclusions remain explicit: special/international routes, provider charges on failed/retried calls, unreserved inbound voice, support, taxes/refunds, free users, overhead and eSIM. Known overhead budget is $741.50/month before hosting upgrades and other omitted costs ($500 Telna, $200 Workspace budget, $30 current DigitalOcean, $11.50 observed Twilio campaign fees). Do not also add actual Workspace $56 to its $200 budget.

## Commercial recommendation and rollout gates

The software fixes reduce waste but do not validate today's prices with all today's allowances and a 20% affiliate commission. Even a single pass through Premium's million-character translation allowance can cost $20 before shared provider credits. There is no defensible small blanket price increase that makes every current entitlement safe at full use.

Preserve core chat. Before setting final launch prices, design a clear included package and separately funded heavy telecom/translation usage, then rerun this model and test beta usage distributions. If a useful package cannot fit a price, raise that package's price rather than hide restrictive limits. Keep annual plans in this calculation; their lower monthly proceeds are especially important.

Before rollout:
1. Approve and publish the shared AI-action definition and finite voice-note allowance, with remaining allowance/reset information in web, iOS and Android. Native client coordination remains outstanding.
2. Verify live media formats with the deployed ffprobe binary, actual provider configuration and timezone behavior. Confirm cache TTL settings without enabling plaintext caching by accident.
3. Complete provider-cost reconciliation and decide the inbound-delivery/overage policy. Do not equate message count with segment cost.
4. Finalize a costed included package and optional heavy-usage purchase path. No price change is implemented in this draft.
5. Validate Telna costs by activated IMSI/network/country and full-pack usage. Exclude eSIM/top-ups from commission promises until that is complete.
6. Then finalize affiliate eligibility, attribution, refunds, payout timing and terms. An application link may collect interest, but must not promise the provisional 20% as a validated offer.

OpenAI's retrieved documentation marks gpt-4o-mini and the current transcription models deprecated. Verify account availability and migration dates before launch, and reprice/test a replacement separately; this branch does not silently switch models.

## Sources

- Account screenshots and founder-provided costs in the pricing review.
- https://www.twilio.com/docs/glossary/what-sms-character-limit
- https://www.twilio.com/en-us/sms/pricing/us
- https://www.twilio.com/en-us/voice/pricing/us?content_language=English
- https://www.twilio.com/en-us/video/pricing
- https://cloud.google.com/products/translate/pricing
- https://developers.openai.com/api/docs/models/gpt-4o-mini
- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/speech-to-text
