# Table Rush Trivia

Live pub/lounge trivia for table teams. Hosts control the game, TV screens show the QR/leaderboard, and tables join from phones.

## Local run

```bash
npm install
npm run build
npm start
```

Open:

```text
http://127.0.0.1:5173/e/demo/admin
```

Default local host PIN:

```text
2468
```

## Production env

```bash
NODE_ENV=production
HOST_PIN=your-secure-admin-pin
DATABASE_URL=postgresql://postgres:YOUR_PERCENT_ENCODED_PASSWORD@db.vwcjyextrhlyjkznlxmx.supabase.co:5432/postgres
PGSSLMODE=require
ALLOWED_ORIGINS=https://your-domain.com
```

## Health checks

```text
/healthz
/readyz
/ops/status
```

## Deploy

Use any host that supports a long-running Node server and WebSockets.

Render:

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/readyz`

Docker/Fly/Railway:

```bash
docker build -t table-rush-trivia .
docker run -p 5173:5173 --env-file .env table-rush-trivia
```

See [DEPLOYMENT.md](DEPLOYMENT.md), [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md), [HOST_RUNBOOK.md](HOST_RUNBOOK.md), and [LIVE_REHEARSAL_CHECKLIST.md](LIVE_REHEARSAL_CHECKLIST.md) for Supabase setup, production checks, and venue launch operations.
