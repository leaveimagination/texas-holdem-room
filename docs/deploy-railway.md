# Railway Deployment

This app needs one Railway web service plus PostgreSQL and Redis.

## Services

Create a Railway project with:

- App service from this GitHub repository.
- PostgreSQL database service.
- Redis database service.

## Variables

Set these variables on the app service:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

Railway provides `PORT`; do not set it manually. The app binds to `0.0.0.0` in production.

## Deploy

The checked-in `railway.json` configures:

- Build: `npm run railway:build`
- Pre-deploy migration: `npx prisma migrate deploy`
- Start: `npm run railway:start`
- Health check: `/api/health`

After the first successful deployment, generate a Railway domain for the app service. Use that public HTTPS domain to create rooms and share invite links.

## Notes

- Keep only one app replica for the first friends-room MVP. Live WebSocket sessions are in process, while room state is in Redis.
- Railway WebSocket connections can be terminated after the platform request-duration limit. Players can refresh and rejoin with the same room-scoped token in local storage.
- This app is virtual-chip only. Do not add payment, wallet, recharge, withdrawal, prize, or public matchmaking copy.
