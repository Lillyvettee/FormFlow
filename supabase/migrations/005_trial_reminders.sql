-- =============================================================================
-- TRIAL REMINDER EMAILS
--
-- Run after 004_billing.sql, and after deploying the trial-reminders function.
--
-- What this does:
--   1. Records which reminders each organization has been sent, so nobody
--      gets the same email twice.
--   2. Schedules the trial-reminders function to run every day at 15:00 UTC
--      (10am Central in summer, 9am in winter).
--
-- BEFORE RUNNING, store the job's password in Supabase Vault (run once, in
-- its own query, with the same value you set as CRON_SECRET for the function;
-- don't save the real value in this file):
--
--   select vault.create_secret('paste-a-long-random-value', 'trial_reminders_cron_secret');
--
-- Run the whole file at once in the Supabase SQL Editor.
-- =============================================================================

begin;

-- 1. Reminder history: any of '7d', '1d', 'ended'.
alter table public.organization_billing
  add column if not exists trial_reminders_sent text[] not null default '{}';

-- 2. Daily job. pg_cron runs it; pg_net makes the web request.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Replace the job if this file is run again.
select cron.unschedule(jobid) from cron.job where jobname = 'trial-reminders';

select cron.schedule(
  'trial-reminders',
  '0 15 * * *',
  $$
  select net.http_post(
    url     := 'https://dmboosigttutyqaujdjv.supabase.co/functions/v1/trial-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'trial_reminders_cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

commit;
