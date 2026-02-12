# Dev baseline (local)

Web: http://localhost:5173
API: http://localhost:5002

## Seed
cd server
npx prisma db seed

## Auth reset
- Use Logout
- If stuck: clear site data for localhost:5173 and localhost:5002
- Verify: GET http://localhost:5002/auth/me
