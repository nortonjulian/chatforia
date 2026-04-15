# Chatforia deployment notes

## Production paths

Frontend live root:
- /var/www/chatforia-app/dist

API app root:
- /var/www/chatforia-api/server

## Domains

Frontend:
- chatforia.com
- www.chatforia.com

API:
- api.chatforia.com

## Frontend deploy steps

From local:
```bash
cd client
npm run build
rsync -avz --delete dist/ root@157.230.128.247:/var/www/chatforia-app/dist/