-- =============================================================================
-- FUNDRAISING GOALS
--
-- Run after 008_sample_data.sql.
--
-- What this does:
--   1. Adds fundraising_goals: a target amount over a date range, either for
--      all donations or for one campaign. Shown with progress bars on the
--      Reports page.
--   2. Adds get_goal_progress(): how much each goal has raised so far. Runs
--      with the caller's own permissions, so it only ever sees their
--      organization's goals and donations. Sample donations don't count.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Goals
-- -----------------------------------------------------------------------------

create table if not exists public.fundraising_goals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  target_amount   numeric(12, 2) not null check (target_amount > 0),
  -- Null counts every donation; otherwise only donations with this campaign.
  campaign        text,
  start_date      date not null,
  end_date        date not null,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists fundraising_goals_organization_id_idx on public.fundraising_goals (organization_id);

-- Fills organization_id from the signed-in member, like the other data tables.
drop trigger if exists set_organization_id on public.fundraising_goals;
create trigger set_organization_id before insert on public.fundraising_goals
  for each row execute function public.set_organization_id();

alter table public.fundraising_goals enable row level security;

drop policy if exists "Members can view" on public.fundraising_goals;
create policy "Members can view" on public.fundraising_goals for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists "Editors can add" on public.fundraising_goals;
create policy "Editors can add" on public.fundraising_goals for insert to authenticated
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Editors can change" on public.fundraising_goals;
create policy "Editors can change" on public.fundraising_goals for update to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data())
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Editors can delete" on public.fundraising_goals;
create policy "Editors can delete" on public.fundraising_goals for delete to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data());

-- -----------------------------------------------------------------------------
-- 2. Progress
--
-- Campaign matching ignores case and extra spaces, like the Reports page does.
-- -----------------------------------------------------------------------------

create or replace function public.get_goal_progress()
returns table (goal_id uuid, raised numeric, gift_count bigint)
language sql stable security invoker set search_path = public
as $$
  select g.id,
         coalesce(sum(d.amount), 0),
         count(d.id)
  from fundraising_goals g
  left join donations d
    on d.organization_id = g.organization_id
   and not d.is_sample
   and d.date between g.start_date and g.end_date
   and (g.campaign is null or lower(trim(coalesce(d.campaign, ''))) = lower(trim(g.campaign)))
  group by g.id
$$;

revoke execute on function public.get_goal_progress() from public, anon;
grant execute on function public.get_goal_progress() to authenticated;

commit;
