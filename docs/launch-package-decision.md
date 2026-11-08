# Launch package decision — 8 November 2026

## Recommendation

Do not quietly shrink the current allowances to force a 20% recurring affiliate offer into the current prices. Preserve ordinary in-app chat and make the expensive services explicit. Keep the live prices unchanged while reviewing the two concrete candidates below. Of these candidates, prefer evaluating the more-included-usage package with beta users; it offers more room for useful paid features. Its proposed prices are a financial candidate, not evidence of willingness to pay or a change authorized for production.

Neither candidate is ready to sell. Both assume phone-network SMS/MMS, PSTN calls and forwarding are funded separately. That purchase path, rate/segment accounting, inbound-delivery policy and enforcement do not exist yet. Keep those features' current live behavior until an approved transition is implemented; do not show a nonexistent Buy credits button. Number rental is included in this model. eSIM packs remain separate and excluded from affiliate promises.

## Concrete alternatives (monthly allowances)

| Feature | Current Plus / Premium | Price-preserving Plus / Premium | More included Plus / Premium |
|---|---:|---:|---:|
| Monthly price | $7.99 / $12.99 | $7.99 / $12.99 | $12.99 / $24.99 |
| Premium annual | $119.99 | $119.99 | $249.99 |
| Shared AI actions | 200 / 500 | 100 / 100 | 200 / 300 |
| Translation characters | 100,000 / 1,000,000 | 25,000 / 25,000 | 50,000 / 75,000 |
| Hosted participant-minutes | 500 / 1,000 | 150 / 200 | 250 / 400 |
| Voice-note minutes | 20 / proposed 120 in #310 | 20 / 60 | 20 / 120 |
| Voicemail transcription minutes | 0 / 30 | 0 / 30 | 0 / 30 |
| Phone-network SMS/MMS | 500 / 1,500 messages | Separately funded | Separately funded |
| PSTN / forwarding minutes | 100 + 100 / 300 + 300 | Separately funded | Separately funded |

Ordinary in-app text chat, existing customization, privacy features and plan eligibility are not cut by these proposals. Current storage limits are not altered; the model uses an unverified storage/hosting cost reserve and needs actual storage/egress validation. Participant-minutes cover every participant: 400 allows 200 minutes of two-person calling, less for groups. Translation counts characters, not messages or words.

The price-preserving candidate has weak differentiation in AI/translation and substantial usage reductions. I do not recommend adopting it solely to retain the current headline prices. The more-included candidate also reduces current caps; those reductions must be disclosed and beta-tested. This is not a claim that every user will find either package sufficient.

## Full-use stress comparison

Run `node server/scripts/launch-package-options.mjs`. Each row assumes all included usage is consumed, 35,000 input tokens and 400 output tokens per AI action, the documented provider rates, a 15% store fee and a hypothetical 20% affiliate commission on receipts after channel fees. These are stress assumptions, not measured typical use or a provable cost ceiling. The script also provides 8,000-token scenarios and web/no-commission variants.

| Candidate | Plan | Direct monthly cost | Remaining after store fee + commission |
|---|---|---:|---:|
| Current-price | Plus $7.99 | $4.33 | $1.10 |
| Current-price | Premium $12.99 | $5.45 | $3.38 |
| Current-price | Premium $119.99/year | $5.45 | $1.35/month |
| More included | Plus $12.99 | $6.70 | $2.14 |
| More included | Premium $24.99 | $10.54 | $6.45 |
| More included | Premium $249.99/year | $10.54 | $3.62/month |

These residuals are not profit. Free users, support, refunds, taxes, storage above the assumed reserve, fixed overhead, and additional infrastructure are still unfunded by this calculation. The $741.50 known monthly overhead budget alone would require about 205 annual-Premium-equivalent subscribers at the $3.62 residual, before those other costs. The Free plan's paid-provider costs need a separate acquisition budget and cannot be assumed covered by unmeasured ads.

## Usage visibility implemented in this draft

- Authenticated `/premium/usage` returns existing plan balances plus measured voice-note transcription usage and a UTC reset date. It uses the same Premium transcription access check as enforcement, sends `private, no-store`, and returns unavailable on database failure.
- Web My Plan and native Plan/Billing screens display server balances, minutes/characters/actions, reset dates and refresh/error states. No client hardcodes these candidate caps or prices.
- Screens explain shared AI actions, participant-minute counting, shared voice-note/live-caption recorded usage, voicemail separation and continuing ordinary in-app chat after feature exhaustion.
- New copy has English fallback resources. Additional translations and native build/device verification are outstanding. No usage purchase UI is offered.

## Release sequence

1. Review the commercial choice above, especially translation/calling experience, annual pricing and the separate telecom offer. No candidate is active in runtime configuration.
2. Validate the chosen package against actual beta distributions and the provider/account rates, storage/egress, free-user subsidy and Telna country/network costs. Do not infer population averages from development usage.
3. Implement the separately funded telecom path and complete provider reconciliation/inbound policy before selling a package that depends on it.
4. Build and verify both native apps and web against the draft backend. Exercise ordinary, near-limit, exhausted, failed-fetch, refresh, account-switch and UTC reset cases, including accessibility and audio playback.
5. Update plan comparison/checkout copy and any affected existing-customer terms only after selecting and implementing a package. Enable affiliate compensation only after eligibility, attribution, refund reversals and payouts are tested. An affiliate application can collect interest without promising an unvalidated commission.

No production deployment, price edit, allowance reduction or affiliate activation is included in this draft.
