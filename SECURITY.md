# Security Policy

## Supported versions
Main branch (latest).

## Reporting a vulnerability
Email security@chatforia.com (or open a private security advisory on GitHub). We aim to triage within 72 hours.

## Best practices in this repo
- HTTP-only, SameSite cookies with secure flag in production.
- CSRF protection + rotating token cookie.
- Rate limiting for auth/invites/media.
- Upload allowlist (MIME + extension) + size caps.
- E2E hybrid encryption for messages; private keys not stored server-side.
- Webhooks: raw body for Stripe; idempotency recommended.
