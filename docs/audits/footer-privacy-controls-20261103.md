# Footer privacy controls

Cookie Settings now saves independent optional analytics and advertising choices in this browser. Unknown/malformed/old preferences default to off. GPC overrides both grants. Saving explicitly reloads to discard already loaded advertising scripts; storage failure reports an error. Cross-tab withdrawal updates ad gates and opts PostHog out. No account-wide synchronization or deletion is claimed.

PostHog is dynamically initialized only after analytics consent; calls before consent are discarded, not queued. Autocapture and replay are disabled. Existing explicit event/identify calls remain consent-gated. Sentry error reporting remains enabled for diagnostics; performance tracing requires analytics consent and session replay is disabled. AdSense insertion and manual slot requests require advertising consent; AdProvider falls back to house promotions without it. Auto ads exclude legal routes. No sign-in, SMS consent, billing or native preference changes.

Validation: 10 focused Jest tests passed covering fail-closed storage, GPC overrides, independent preferences, rejection, SDK calls before/after consent and ad script insertion. Production Vite build passed. Browser/device checks after deployment remain required for persistence, withdrawal/reload, cross-tab changes, GPC and provider network requests. No live browser verification claimed.

This first-party gate is NOT a Google-certified CMP and does not manufacture TCF strings. Confirm the AdSense Privacy & messaging setup for regional consent before enabling personalized ad serving. Official requirement: https://support.google.com/adsense/answer/13554116
PostHog SDK reference: https://posthog.com/docs/references/posthog-js

Remaining footer release dependencies: website notice PR298 lacks verified upstream notice for use-composed-ref 1.4.0; iOS PR76 requires Xcode bundle/offline UI checks and binary notices review; Android PR104 requires final regression/release artifact checks and notice completeness review. These controls do not establish complete legal compliance.
