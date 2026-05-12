# Chatforia

Chatforia is a full-stack messaging and connectivity platform built for real-time conversations, privacy-first communication, global translation, SMS/voice workflows, premium subscriptions, and future wireless/eSIM services.

This repository is the main Chatforia web monorepo. It contains the React/Vite client and the Node/Express API server.

---

## Project Status

Chatforia is actively being developed for production launch. The web app includes the core messaging experience, account/auth flows, billing surfaces, SMS/calling features, admin/support tools, legal/marketing pages, and wireless/eSIM dashboard scaffolding.

The iOS app is maintained separately and connects to the same backend API.

---

## Repository Structure

```txt
chatforia/
├── client/              # React + Vite web app
├── server/              # Node.js + Express API, Socket.IO, Prisma
├── package.json         # npm workspaces and root scripts
├── package-lock.json
└── README.md
```

The root workspace includes both `client` and `server` packages.

---

## Core Features

### Messaging

- Real-time chat powered by Socket.IO.
- 1:1 and group chat support.
- Message send, edit, delete, read receipts, reactions, attachments, and disappearing messages.
- Per-room message sync with server-backed persistence.
- Contact saving, aliases, favorites, and people/invite flows.

### Privacy & Security

- Hybrid end-to-end encryption architecture using public keys, encrypted message/session keys, and recovery flows.
- JWT/session-based authentication.
- Email verification, password reset, and OAuth support.
- Device registration and browser pairing support.
- Strict server-side environment validation for production-critical secrets.

### Translation & Internationalization

- User language preferences.
- Auto-translation support.
- i18next-powered web localization.
- Database-backed language and translation models.

### SMS, Voice, Video & Telecom

- SMS threads and compose flows.
- Twilio-backed SMS and voice infrastructure for the current messaging/calling layer.
- Voice/video calling UI surfaces.
- Dialer, call history, voicemail, phone number lifecycle, and forwarding-related backend models.

### Billing & Premium Plans

- Free, Plus, Premium, and Wireless plan modeling.
- Billing return/success flows.
- Premium route guards.
- Ad suppression for premium users.
- Stripe/Paddle/App Store related billing infrastructure is present or scaffolded depending on environment.

### Wireless / eSIM

- Wireless dashboard and management routes.
- eSIM activation page.
- Mobile data pack purchase models.
- Provider-oriented backend configuration for future connectivity workflows.

### Admin, Safety & Support

- Admin layout and route guard.
- User management, reports, audit logs, and support tooling.
- Help center, safety, blog, contact, legal, and marketing pages.
- Support widget in the authenticated app shell.

---

## Tech Stack

### Frontend

- React 18
- Vite
- Mantine UI
- React Router
- i18next / react-i18next
- Socket.IO client
- Twilio Voice/Video SDKs
- Sentry and PostHog integration points
- Jest + React Testing Library

### Backend

- Node.js with ES modules
- Express 5
- Socket.IO
- Prisma ORM
- PostgreSQL
- Redis / Socket.IO Redis adapter support
- Twilio telecom integration for SMS/voice workflows
- Stripe/Paddle billing infrastructure
- Resend/SendGrid/SMTP email support
- Cloudflare R2/S3-compatible media storage support
- Pino logging
- Sentry Node integration
- Jest, Supertest, and Artillery

---

## Prerequisites

Install the following before running locally:

- Node.js 20+
- npm
- PostgreSQL 14+
- Git

Optional, depending on which features you are testing:

- Redis
- Twilio credentials
- Stripe or Paddle credentials
- Resend, SendGrid, or SMTP credentials
- Cloudflare R2/S3-compatible storage credentials
- OpenAI API key

---

## Getting Started

Clone the repo:

```bash
git clone https://github.com/nortonjulian/chatforia.git
cd chatforia
```

Install dependencies:

```bash
npm install
```

Generate Prisma client:

```bash
npm run -w server prisma:generate
```

Create a local server environment file:

```bash
cp server/.env.example server/.env
```

If `server/.env.example` does not exist yet, create `server/.env` manually with at least:

```env
NODE_ENV=development
PORT=5002
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/chatforia?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
FRONTEND_ORIGIN="http://localhost:5173"
CORS_ORIGINS="http://localhost:5173"
DISABLE_TELCO_VALIDATION=true
```

Run migrations:

```bash
cd server
npx prisma migrate dev
cd ..
```

Start the backend:

```bash
npm run -w server dev
```

Start the frontend in another terminal:

```bash
npm run -w client dev
```

Default local URLs:

- Web app: `http://localhost:5173`
- API server: `http://localhost:5002`

---

## Environment Variables

### Server

The backend reads normalized environment variables from `server/config/env.js` and validates required combinations in `server/config/validateEnv.js`.

Minimum local development variables:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime mode: `development`, `test`, or `production`. |
| `PORT` | API port. Defaults to `5002`. |
| `DATABASE_URL` | PostgreSQL connection string. Required. |
| `JWT_SECRET` | Token signing secret. Required. |
| `FRONTEND_ORIGIN` | Web app origin for CORS/cookies/redirects. Required in production. |
| `CORS_ORIGINS` | Comma-separated allowed origins. |
| `DISABLE_TELCO_VALIDATION` | Set `true` locally when Twilio credentials are not configured. |

Common optional variables:

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Server session signing secret. |
| `SENTRY_DSN` | Backend error tracking. |
| `OPENAI_API_KEY` | AI features and smart replies. |
| `RESEND_API_KEY` | Email provider. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | SMTP fallback. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio SMS/voice features. |
| `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER` | Twilio messaging identity. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_S3_ENDPOINT`, `R2_BUCKET` | R2/S3-compatible media storage. |
| `BILLING_PROVIDER`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | Paddle billing configuration. |
| `FEATURE_AI`, `FEATURE_EMAIL`, `FEATURE_MEDIA_UPLOADS`, `FEATURE_R2`, `FEATURE_ESIM` | Feature flags. |

### Client

The client reads Vite variables and falls back to local/dev defaults in `client/src/config.js`.

Common client variables:

```env
VITE_API_BASE_URL=http://localhost:5002
VITE_WS_URL=ws://localhost:5002
VITE_AD_PROVIDER=house
VITE_ADS_ENABLED=true
VITE_SENTRY_DSN=
VITE_SENTRY_TRACES_RATE=0.15
VITE_SENTRY_REPLAY=false
```

For production:

```env
VITE_API_BASE_URL=https://api.chatforia.com
VITE_WS_URL=wss://api.chatforia.com
```

---

## Available Scripts

### Root

```bash
npm run lint
npm run format
npm run format:check
npm run test
npm run test:server
npm run test:client
npm run test:e2e
npm run ci
```

### Client

```bash
npm run -w client dev
npm run -w client build
npm run -w client preview
npm run -w client test
```

### Server

```bash
npm run -w server dev
npm run -w server start
npm run -w server test
npm run -w server coverage
npm run -w server prisma:generate
npm run -w server seed:languages
```

---

## Database

Prisma schema location:

```txt
server/prisma/schema.prisma
```

Useful commands:

```bash
npm run -w server prisma:generate
cd server && npx prisma migrate dev
cd server && npx prisma studio
```

The schema includes domains for users/auth, devices, languages, pricing, family groups, purchases, chatrooms, messages, E2EE keys, contacts, reports, status/stories, bots, calls, phone numbers, voicemail, wireless/eSIM data packs, and accessibility preferences.

---

## Testing

Run the full test suite:

```bash
npm test
```

Run server tests:

```bash
npm run test:server
```

Run client tests:

```bash
npm run test:client
```

Run E2E tests:

```bash
npm run test:e2e
```

Run CI locally:

```bash
npm run ci
```

---

## Production Notes

Before deploying production, confirm:

- `DATABASE_URL` points to the production database.
- `JWT_SECRET` and `SESSION_SECRET` are strong and unique.
- `FRONTEND_ORIGIN`, `CORS_ORIGINS`, cookie settings, and HTTPS settings are correct.
- Billing webhooks are configured and verified.
- Email provider credentials are live.
- Twilio credentials are configured only in the correct environment.
- R2/S3 media storage credentials are configured if uploads are enabled.
- Sentry/PostHog or equivalent observability is configured.
- Prisma migrations have been applied.

---

## Security Notes

Do not commit real `.env` files, private keys, API secrets, production database URLs, Stripe/Paddle secrets, Twilio credentials, Apple credentials, or R2/S3 credentials.

Use local `.env` files for development and the deployment platform's secret manager for staging/production.

---

## Roadmap

Near-term priorities include:

- Final production billing hardening.
- Premium feature gating verification across web and mobile.
- Admin/support visibility for subscription and user issues.
- Android app development.
- iOS/App Store polish and parity checks.
- Wireless/eSIM provider integration and activation flow hardening.
- Continued localization expansion.

---

## License

Proprietary — all rights reserved.

Contact Chatforia for licensing, partnership, or usage inquiries.
