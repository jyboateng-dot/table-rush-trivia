# Production Operations

This app is live-hostable today, but venue reliability depends on hosting, domain setup, monitoring, and rehearsals.

## 1. Hosting Plan

Render Free is acceptable for demos, but not recommended for live venue use because free services can sleep after inactivity.

Recommended immediate setup:

- Keep the current Render service.
- Upgrade the service from Free to a paid always-on instance before a real venue night.
- Confirm `render.yaml` uses `plan: starter`.
- Redeploy after changing the plan.
- Visit `/readyz` and `/ops/status` before guests join.

Production checks:

```text
https://your-domain.com/readyz
https://your-domain.com/ops/status
```

Expected:

- `ok: true`
- `persistence: postgres`
- `websocketAdapter: postgres`
- `allowedOriginsConfigured: true`
- `defaultHostPin: false`

## 2. Custom Domain

Recommended domain pattern:

```text
play.yourdomain.com
```

After adding the domain on the host:

1. Add the DNS record requested by the host, usually a CNAME.
2. Wait for HTTPS certificate issuance.
3. Open the app through the custom domain.
4. Create a test event.
5. Scan the QR from a phone using mobile data.

## 3. Allowed Origins

After the custom domain works, update the host environment variable:

```text
ALLOWED_ORIGINS=https://play.yourdomain.com
```

If keeping the Render URL as a backup, use both:

```text
ALLOWED_ORIGINS=https://play.yourdomain.com,https://table-rush-trivia.onrender.com
```

Redeploy after changing environment variables.

## 4. Monitoring

Use an uptime monitor against:

```text
https://play.yourdomain.com/ops/status
```

Alert when:

- HTTP status is not 200.
- `ok` is not `true`.
- `persistence` is not `postgres`.
- `defaultHostPin` is `true`.

Check manually 30 minutes before a show and again 5 minutes before starting.

## 5. Backups

Supabase stores the event state, teams, submissions, and logs.

Before recurring venue use:

- Enable the highest backup level available on the Supabase plan you choose.
- Export final event results after every game from the admin dashboard.
- Keep exported results in a shared venue folder.

For manual database backup, use `pg_dump` from a trusted machine with the production `DATABASE_URL`.

```bash
pg_dump "$DATABASE_URL" > table-rush-trivia-backup.sql
```

Do not commit backups or `.env` files to Git.

## 6. Go-Live Routine

1. Confirm the hosting plan is always-on.
2. Confirm custom domain HTTPS works.
3. Confirm `ALLOWED_ORIGINS` matches the custom domain.
4. Open `/ops/status`.
5. Run the rehearsal checklist.
6. Create the real event.
7. Display the TV link.
8. Start the game only after several tables have successfully joined.

