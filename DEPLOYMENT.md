# Chatforia deployment notes

## Production infrastructure

### Frontend
- Droplet: `chatforia-web-01`
- Host/IP: `24.144.80.189`
- Live root: `/var/www/chatforia`
- Runtime config: `/var/www/chatforia/env.js`

### Local build output
- client/dist

### Live production directory
- /var/www/chatforia

### Important
- Do NOT deploy to /var/www/chatforia-app/dist
- That path is no longer used for serving the frontend

### API
- Droplet: `chatforia-api-01`
- Host/IP: `157.230.128.247`
- App root: `/var/www/chatforia-api/server`

## Domains

### Frontend
- `https://chatforia.com`
- `https://www.chatforia.com`

### API
- `https://api.chatforia.com`

## Frontend deployment

Frontend deploys are now handled by **GitHub Actions** on push to `main`.

### Workflow
- File: `.github/workflows/deploy.yml`

### Required GitHub Actions secrets
- `DO_HOST=24.144.80.189`
- `DO_USER=root`
- `DO_SSH_KEY=<private key for ~/.ssh/chatforia_deploy>`

## Manual frontend deploy fallback

From local:

```bash
cd client
npm run build
rsync -avz --delete dist/ root@24.144.80.189:/var/www/chatforia/