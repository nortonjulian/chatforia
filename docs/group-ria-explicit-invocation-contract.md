# Group Ria explicit-invocation contract (implementation checklist)

Status: design/QA contract only; production Group Ria remains disabled.

## Current mismatch
- The website normally posts per-participant encrypted payloads with `content: null`; the backend Group Ria dispatcher accepts a saved plaintext `@Ria` or `/ask` source and refuses ciphertext, message keys, and message payloads.
- A temporary localhost QA browser bridge proved the UI works with explicit plaintext, but it must never be merged or deployed.
- The tested local runner uses fake users, mock AI, and a separate PostgreSQL database; it does not prove production-grade API authorization.

## Security rules (must be enforced by the server, not asserted by the client)
1. The feature flag is OFF by default and production remains OFF during implementation.
2. Ordinary messages use their existing encryption pipeline unchanged.
3. Only an explicit, bounded `@Ria` or `/ask` request in an eligible group may use a plaintext AI-invocation path. Never infer a user opted in from the presence of a text string alone.
4. Before persisting plaintext, check the authenticated sender's membership, Ria consent timestamp and active permission, room group status, room AI permission/mode, bot membership, another consenting human participant, and each participant's Strict-E2EE setting. Revalidate before provider call and before reply persistence; fail closed on state changes.
5. Require an explicit client `riaInvocation` signal (versioned) plus a supported mention command, not merely `content` from the normal encrypted-message endpoint. Reject attempts to supply ciphertext, encrypted payloads or message keys on an invocation request.
6. Explicitly communicate to users that their invocation text and the AI response are handled as plaintext accessible to the server and provider, and that previous group history is not sent.
7. Preserve unique source-message claims, client message idempotency, canonical server reply persistence, and per-participant shaped Socket.IO upserts and reconnect recovery.
8. The new endpoint must not bypass existing rate limiting, bans, abuse controls, room permissions, CSRF/session checks, or server-side input limits.
9. Do not leak user message text, auth tokens, or provider replies to logs, diagnostics, analytics, or unrelated users.
10. No external SMS, phone provisioning, billing, AI-provider, email, or push calls in isolated QA.

## Implementation sequence
- Backend: introduce guarded, explicit invocation API contract and negative tests; consider storing encrypted ordinary message content separately from any deliberately shared invocation text. Review the complete data lifecycle before deciding schema changes.
- Web: replace the QA-only branch bridge with the versioned API call and explicit disclosure; preserve regular encrypted sends.
- iOS and Android: implement the same explicit intent and disclosure, separate QA application configurations, and never connect QA accounts to production accidentally.
- Verify consent OFF/revocation, sender/member changes, strict E2EE, non-group/SMS, missing bot, encrypted attempts, duplicate/retry, failed mock provider, reconnect, accessibility, and absence of unintended provider requests.
- Rollout: review/merge only production-safe changes, perform isolated-device acceptance, and enable production only via deliberate separate rollout approval.

## Important distinction
The earlier local website and Socket.IO successes are acceptance of a temporary mock bridge, *not* release approval for Ria with production encryption and privacy guarantees.
