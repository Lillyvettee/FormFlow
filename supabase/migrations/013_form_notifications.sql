-- =============================================================================
-- FORM EMAIL NOTIFICATIONS
--
-- Run after 012_services_and_case_notes.sql, then deploy the form-notify
-- function (see BILLING_SETUP.md).
--
-- What this does:
--   Adds notified_at to form_submissions: when the form-notify function sent
--   that response's emails (staff alert and respondent confirmation). The
--   function claims a response by setting it, so each response's emails go
--   out at most once, however many times the function is called.
--
-- Run the whole file at once in the Supabase SQL Editor.
-- =============================================================================

begin;

alter table public.form_submissions add column if not exists notified_at timestamptz;

-- Respondents never set this themselves; only the function (service role) does.
create or replace function public.clear_submission_notified_at()
returns trigger
language plpgsql
as $$
begin
  new.notified_at := null;
  return new;
end
$$;

drop trigger if exists clear_submission_notified_at on public.form_submissions;
create trigger clear_submission_notified_at before insert on public.form_submissions
  for each row execute function public.clear_submission_notified_at();

-- Counting recent emails per form (the hourly cap) stays fast.
create index if not exists form_submissions_notified_idx on public.form_submissions (form_id, notified_at) where notified_at is not null;

commit;
