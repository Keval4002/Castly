-- Dukaanshot scheduled jobs (Supabase pg_cron + pg_net). Run in the SQL editor, or `node scripts/...` as documented in docs/OPERATIONS.md.
-- Prereqs: extensions pg_cron + pg_net; Vault secret 'dukaanshot_cron_secret' == CRON_SECRET in Vercel.
-- Replace dukaanshot.vercel.app before running the first block.

select cron.unschedule(jobid) from cron.job where jobname = 'dukaanshot-sweep';
select cron.schedule('dukaanshot-sweep', '*/2 * * * *', $$
  select net.http_get(
    url := 'https://dukaanshot.vercel.app/api/cron/sweep',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dukaanshot_cron_secret')),
    timeout_milliseconds := 30000);
$$);

-- Keep-alive for the free plan (projects pause after 7 days without API/DB activity).
select cron.unschedule(jobid) from cron.job where jobname = 'dukaanshot-keepalive';
select cron.schedule('dukaanshot-keepalive', '0 */6 * * *', $$
  select net.http_get(url := 'https://hpuwupmnhsgxgelmtfgb.supabase.co/auth/v1/health', headers := jsonb_build_object('apikey', 'YOUR-PUBLIC-ANON-KEY'), timeout_milliseconds := 15000);
$$);

-- Housekeeping: cron history grows forever otherwise.
select cron.unschedule(jobid) from cron.job where jobname = 'dukaanshot-cron-cleanup';
select cron.schedule('dukaanshot-cron-cleanup', '17 3 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '3 days';
  delete from net._http_response where created < now() - interval '3 days';
$$);
