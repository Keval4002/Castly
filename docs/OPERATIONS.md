# Operations runbook

Everything here is for whoever runs the production deployment. Nothing in this file has been run against
production by the developers/agents who wrote it: **verify each command against your own project before use.**

## 1. Applying migrations to production (0003–0006 and later)

`npm run db:migrate` applies every migration that has not run yet, in order, in one transaction each. At the time
of writing production may be missing **0003 (photo cleaning), 0004 (workspace / products), 0005 (quality gate,
kill switch, idempotency) and 0006 (shots, cost ledger, multi-photo products)**. Migrations 0004 and 0006 contain
data backfills. Do not skip the backup.

1. **Deploy order.** Migrate first, then deploy the code. The new code needs the new columns; the old code ignores
   them, so this order is safe. Never deploy the code first.
2. **Back up.**
   - Supabase dashboard → Database → Backups: confirm a backup from the last few minutes exists (Pro plans: take a
     manual backup / note the point-in-time-recovery timestamp). Free plans have no downloadable backups, so use
     step 2b.
   - 2b. A logical dump you hold yourself (needs `pg_dump` 15+; use the *direct* connection string, port 5432, not
     the pooler):
     `pg_dump "$DIRECT_DATABASE_URL" --format=custom --no-owner --file dukaanshot-before-0006.dump`
     then check it is not empty and lists the tables: `pg_restore --list dukaanshot-before-0006.dump | head`.
   - Write down the row counts you will compare afterwards:
     `select (select count(*) from products) products, (select count(*) from generations) generations, (select count(*) from credit_ledger) ledger;`
3. **Pause generation** so no job is in flight during the migration: `npm run kill-switch -- on "Maintenance — back in a few minutes"`
   (this itself needs migration 0005; if it is not applied yet, set `GENERATION_PAUSED=true` and redeploy, or just
   migrate during a quiet hour).
4. **Migrate**: `DATABASE_URL=<production direct url> npm run db:migrate`.
5. **Verify**: `DATABASE_URL=<production url> npm run db:verify`. It is read-only and checks, among other things,
   that **the number of products with a `front` photo equals the number of products** (the 0006 backfill), that no
   shot is stuck in a state the new code can't handle, and that every balance equals the sum of its ledger.
   **Do not deploy if any check says FAIL.**
6. Re-run the row-count query from step 2; products/generations/ledger must be unchanged (0006 only adds).
7. Deploy the code, then `npm run kill-switch -- off`.
8. **Rollback**: the migrations only add tables/columns/enum values, so the previous code keeps working against the
   new schema; roll back by redeploying the previous code. Restore the dump only if data was damaged.

## 2. Scheduler for the sweep (Supabase pg_cron, no Vercel cron)

`GET /api/cron/sweep` restarts shots whose worker died, starts jobs nobody started, re-checks held images and
fails + refunds jobs past 25 minutes. It is idempotent and safe to call as often as you like; every 1–2 minutes is
plenty. Without it, jobs still recover when their owner polls, but a user who closed the tab would wait for the
25-minute backstop only when they come back.

1. Generate a secret (≥16 chars): `openssl rand -hex 24`. Set it as **`CRON_SECRET`** in the Vercel project (Production)
   and redeploy. While `CRON_SECRET` is unset the route answers 503 (disabled).
2. In Supabase: Database → Extensions → enable **pg_cron** and **pg_net**.
3. Put the same secret in Supabase Vault, then schedule (SQL editor; replace the domain):

```sql
select vault.create_secret('PASTE-THE-CRON_SECRET-VALUE', 'dukaanshot_cron_secret');

select cron.schedule(
  'dukaanshot-sweep',
  '*/2 * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-PRODUCTION-DOMAIN/api/cron/sweep',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dukaanshot_cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);
```

4. Check it runs:
   `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;`
   and the HTTP result: `select status_code, left(content, 200) from net._http_response order by created desc limit 5;`
   You should see `200` and a body like `{"ok":true,"plannedQueued":0,...}`. A `401` means the secrets differ; `503` means
   `CRON_SECRET` is not set on the deployment.
5. Stop it: `select cron.unschedule('dukaanshot-sweep');`

`pg_net` calls are asynchronous and the response is not awaited by the job; the sweep itself keeps running on the
server. Check the exact `net.http_get` and Vault function signatures against the current Supabase docs when you
enable them; they have changed between releases.

**Is the sweep alive?** If this returns a row, a job has been stuck for more than 10 minutes and the sweep is not
doing its job: `select id, status, created_at from generations where status in ('queued','running') and created_at < now() - interval '10 minutes';`

## 3. Alerts

Operational alerts are always written as one JSON log line containing `"level":"alert"` and a `"kind"`. If
`ALERT_WEBHOOK_URL` is set (a Slack/Discord webhook or any endpoint accepting `{"text": …, "content": …}`) they are also
posted there, at most once per kind per 5 minutes per server instance.

| kind | Meaning | What to do |
|---|---|---|
| `shot_dispatch_fallback` | An HTTP dispatch of a shot failed and the shot ran *inside the job's own invocation* instead. The image still completes, but the per-shot isolation/time budget is lost, and the cause usually affects every shot. | Check `APP_URL` (must be the public production URL), Vercel deployment protection on the production domain, and Vercel status. Each occurrence is also stored in `provider_calls` with `stage = 'dispatch'`. |
| `shot_dispatch_failed` | A dispatch from the sweep/poll failed and the shot was left pending (it will be retried). | Same checks. |
| `cost_budget_reached` | A shot or a whole set hit its spend cap (`SHOT_BUDGET_MICROS`, `SET_BUDGET_FACTOR` in `src/lib/image/costs.ts`); the shot was failed and the customer refunded. | Look at `provider_calls` for that generation: repeated restarts, fallbacks or retries. |

If you have no webhook, add a log alert on `"level":"alert"` in your log drain / Vercel log alerts. Useful queries:

```sql
-- fallbacks in the last hour
select count(*) from provider_calls where stage = 'dispatch' and created_at > now() - interval '1 hour';
-- spend per generation, most expensive first (USD)
select generation_id, sum(est_cost_micros) / 1e6 as usd, count(*) calls
from provider_calls where created_at > now() - interval '1 day' group by 1 order by 2 desc limit 20;
```

## 4. Emergency stop

`npm run kill-switch -- on "message shown to users"` / `off` / `status` (takes effect within ~5 s, no deploy), or set
`GENERATION_PAUSED=true`. New jobs are refused with HTTP 503 and queued jobs are refunded without calling a provider.

## 5. Tests must never touch a real database

The unit tests and the Playwright setup **refuse to start unless the database name contains "test"**
(`tests/unit/db-guard.ts`), and `resetDb()` re-checks `current_database()` before truncating. Point
`TEST_DATABASE_URL` / `E2E_DATABASE_URL` at a dedicated database such as `dukaanshot_test`. If another process also
runs tests on the same database the runs interfere with each other (rows vanish mid-test); give each runner its own
database.

## 6. Open items for the owner

- Support channel shown to users (email / WhatsApp): not decided, so no support link exists in the app yet.
- Vercel plan (affects whether Vercel Cron could be used instead of pg_cron; the runbook above does not need it).
