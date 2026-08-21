# Table Rush Trivia Deployment

## Required environment

Set these variables on the hosting provider:

```bash
HOST_PIN=your-secure-admin-pin
DATABASE_URL=postgresql://postgres:YOUR_PERCENT_ENCODED_PASSWORD@db.vwcjyextrhlyjkznlxmx.supabase.co:5432/postgres
PGSSLMODE=require
ALLOWED_ORIGINS=https://your-domain.com
```

Supabase connection strings work as `DATABASE_URL`. The server creates the required tables automatically on startup. You can also run `server/schema.sql` manually in Supabase SQL Editor.

## Build and run

```bash
npm install
npm run build
npm start
```

## Scaling notes

When `DATABASE_URL` is set:

- Events and teams are persisted in PostgreSQL/Supabase.
- The active question, phase, timer start time, scores, votes, and anti-cheat flags survive server restarts.
- Socket.IO uses the Postgres adapter so broadcasts can reach clients connected to different server instances.

For multiple server instances, use a host that supports WebSockets and sticky sessions/session affinity.

## Health checks

Use these routes on the host:

```text
/healthz
/readyz
```

`/readyz` checks the Postgres connection when `DATABASE_URL` is configured.

## Supabase setup

1. Create a Supabase project.
2. Copy the pooled or direct Postgres connection string.
3. Set it as `DATABASE_URL` on the app host.
4. Set `PGSSLMODE=require`.
5. Start the app. Tables are created automatically.

If the host blocks automatic table creation, run `server/schema.sql` in the Supabase SQL Editor.

## Venue launch checklist

- Use a public HTTPS domain.
- Confirm the TV QR displays the public `/e/{eventId}/join` URL.
- Open admin, TV, and at least 5 phones at the same time.
- Test voting, lock voting, start question, answer submit, reveal, next question, finish.
- Test one phone on mobile data and one on venue Wi-Fi.
- Change `HOST_PIN` from the local default.
