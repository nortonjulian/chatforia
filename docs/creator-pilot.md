# Creator pilot launch preparation

Affiliate enrollment, commissions and payouts are deferred. Public Careers copy describes creator partnerships. Existing mobile creator-link capture and tests stay intact. Historical pricing scripts default to no commission; optional affiliate sensitivity requires `--include-affiliate-scenario`. No app/data price or entitlement changes are included.

## Attribution

Set `CREATOR_PILOT_CODES` to comma-separated approved codes (3–40 ASCII letters, digits, underscores or hyphens). Empty means no codes are attributed. Assign stable, unique codes to creators; do not reuse a retired code for another person. Keep the code-to-creator mapping in the campaign record. Unknown or malformed codes are ignored and never prevent signup.

Web accepts `/ref/CODE` and `/register?ref=CODE`, retaining first touch for 30 days. The existing mobile implementations use the same window. Storage denial falls back to memory on web. This is link attribution, not proof of identity or a guaranteed cross-device/install attribution mechanism.

The backend writes approved code, source and timestamp only on new-account creation, in the same transaction. Existing-account login/linking never overwrites attribution. Password registrations use source `registration` because platform is not asserted by a trusted server route; OAuth sources come from the existing routes. Referral codes do not grant benefits or authorize payments. Existing user IDs provide the join to billing records; no new purchase/commission ledger or creator dashboard is introduced.

## Creator offer

Small invitation-only pilot: 30 days of Premium plus one 3GB data pack, with agreed honest content, disclosure and a tracked link. Record each grant and expiration separately. Attribution does not automatically issue comps, renew plans or charge creators. No grants have been issued by this change.

## Rollout

1. Review the additive migration and apply it before deploying code that uses the new User fields. No production migration has been run.
2. Configure approved codes for the pilot; keep the list empty until ready.
3. Verify web, iOS and Android links, password and Google/Apple signup, existing-account login, expired codes and subsequent paid conversion reconciliation. Native code is preserved rather than rebuilt here.
4. Confirm the campaign storage/analytics behavior fits the existing consent and privacy implementation before launch.

Deploying, merging and issuing comps remain separate actions. This branch is based on the plan-usage-visibility branch; account for that dependency when preparing the release.

## Validation

- 90 backend tests passed across creator attribution, password auth, OAuth identity linking, web OAuth state and mobile MFA suites in disposable PostgreSQL.
- The exact additive SQL migration was applied against the pre-change User columns in that disposable database.
- Web referral storage, registration, login and OAuth completion tests passed; production Vite build passed.
- Both economics scripts omit affiliate scenarios by default and include them only with the explicit flag.
- Native apps were not modified or rebuilt; no production deployment or migration was performed.
