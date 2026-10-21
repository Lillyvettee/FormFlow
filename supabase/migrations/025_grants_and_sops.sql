-- =============================================================================
-- OPERATIONS: GRANT READINESS AND SOPs
--
-- Run after 024_analytics.sql.
--
-- Mission and Enterprise only (plan feature 'operations').
--
-- What this does:
--   1. grant_narratives: saved answers to common grant questions.
--   2. grants: applications being tracked (funder, amounts, deadline, status,
--      report due date), with the narratives to include in their packet.
--   3. sops and sop_versions: standard operating procedures, with every
--      earlier version kept automatically when one is changed.
--   4. get_grant_numbers(): the impact figures for a period (and the period
--      before it), reusing funder_totals() from 020 and outcome results.
--
-- Everyone in the organization can read these; owners, admins and members
-- can add, change and delete them, while the plan includes them and the
-- organization isn't read-only.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Plan feature
--
-- Replaces the version from 024, adding 'operations'.
-- -----------------------------------------------------------------------------

create or replace function public.plan_has_feature(p_plan text, p_feature text)
returns boolean
language sql immutable
as $$
  select p_plan in ('mission', 'enterprise')
     and p_feature in ('import_export', 'branding', 'funder_advanced', 'cards_scanning', 'analytics', 'operations')
$$;

-- True when the caller may change Operations records.
create or replace function public.can_edit_operations()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_edit_org_data() and public.plan_has_feature(public.org_plan(public.current_org_id()), 'operations')
$$;

revoke execute on function public.can_edit_operations() from public, anon;
grant execute on function public.can_edit_operations() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

create table if not exists public.grant_narratives (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null check (length(trim(title)) between 1 and 150),
  category        text not null default 'Other' check (length(category) between 1 and 60),
  body            text not null default '' check (length(body) <= 20000),
  updated_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.grants (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  funder           text not null check (length(trim(funder)) between 1 and 150),
  name             text check (name is null or length(name) <= 150),
  amount_requested numeric(14, 2) check (amount_requested is null or amount_requested >= 0),
  amount_awarded   numeric(14, 2) check (amount_awarded is null or amount_awarded >= 0),
  status           text not null default 'researching'
                     check (status in ('researching', 'writing', 'submitted', 'awarded', 'declined', 'reporting', 'closed')),
  deadline         date,
  report_due       date,
  -- The grant period, used for the packet's impact numbers.
  period_start     date,
  period_end       date,
  contact          text check (contact is null or length(contact) <= 300),
  notes            text check (notes is null or length(notes) <= 5000),
  narrative_ids    uuid[] not null default '{}',
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end >= period_start)
);

create table if not exists public.sops (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null check (length(trim(title)) between 1 and 150),
  category        text not null default 'General' check (length(category) between 1 and 60),
  body            text not null default '' check (length(body) <= 50000),
  version         integer not null default 1,
  updated_by      uuid default auth.uid() references auth.users(id) on delete set null,
  -- Kept so the page still says who, after that member leaves.
  updated_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.sop_versions (
  id              bigint generated always as identity primary key,
  sop_id          uuid not null references public.sops(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version         integer not null,
  title           text not null,
  category        text not null,
  body            text not null,
  edited_by_name  text,
  edited_at       timestamptz not null
);

create index if not exists grant_narratives_org_idx on public.grant_narratives (organization_id);
create index if not exists grants_org_idx on public.grants (organization_id, deadline);
create index if not exists sops_org_idx on public.sops (organization_id, category);
create index if not exists sop_versions_sop_idx on public.sop_versions (sop_id, version desc);

-- -----------------------------------------------------------------------------
-- 3. Organization id, timestamps and SOP versions
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['grant_narratives', 'grants', 'sops']
  loop
    execute format('drop trigger if exists set_organization_id on public.%I', t);
    execute format('create trigger set_organization_id before insert on public.%I for each row execute function public.set_organization_id()', t);
  end loop;
end $$;

-- Stamps who and when; for SOPs, keeps the previous version and counts up.
create or replace function public.stamp_operations_record()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  new.updated_at := now();
  if tg_table_name in ('grant_narratives', 'sops') then
    new.updated_by := auth.uid();
  end if;
  if tg_table_name = 'sops' then
    select coalesce(nullif(trim(m.display_name), ''), m.email) into v_name
    from organization_members m where m.user_id = auth.uid() and m.organization_id = new.organization_id;
    new.updated_by_name := coalesce(v_name, new.updated_by_name);
    if tg_op = 'UPDATE' and (new.title, new.category, new.body) is distinct from (old.title, old.category, old.body) then
      insert into sop_versions (sop_id, organization_id, version, title, category, body, edited_by_name, edited_at)
      values (old.id, old.organization_id, old.version, old.title, old.category, old.body, old.updated_by_name, old.updated_at);
      new.version := old.version + 1;
    elsif tg_op = 'UPDATE' then
      new.version := old.version;
    end if;
  end if;
  return new;
end
$$;

revoke execute on function public.stamp_operations_record() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['grant_narratives', 'grants', 'sops']
  loop
    execute format('drop trigger if exists zz_stamp on public.%I', t);
    execute format('create trigger zz_stamp before insert or update on public.%I for each row execute function public.stamp_operations_record()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Security rules
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['grant_narratives', 'grants', 'sops']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Members can view" on public.%I', t);
    execute format('create policy "Members can view" on public.%I for select to authenticated using (organization_id = public.current_org_id())', t);
    execute format('drop policy if exists "Editors can add" on public.%I', t);
    execute format('create policy "Editors can add" on public.%I for insert to authenticated with check (organization_id = public.current_org_id() and public.can_edit_operations())', t);
    execute format('drop policy if exists "Editors can change" on public.%I', t);
    execute format('create policy "Editors can change" on public.%I for update to authenticated using (organization_id = public.current_org_id() and public.can_edit_operations()) with check (organization_id = public.current_org_id() and public.can_edit_operations())', t);
    execute format('drop policy if exists "Editors can delete" on public.%I', t);
    execute format('create policy "Editors can delete" on public.%I for delete to authenticated using (organization_id = public.current_org_id() and public.can_edit_operations())', t);
  end loop;
end $$;

-- Versions are read-only; only the trigger above writes them.
alter table public.sop_versions enable row level security;
drop policy if exists "Members can view" on public.sop_versions;
create policy "Members can view" on public.sop_versions for select to authenticated
  using (organization_id = public.current_org_id());

-- -----------------------------------------------------------------------------
-- 5. Impact numbers for grants
-- -----------------------------------------------------------------------------

/**
 * Totals for p_from..p_to (null p_from = everything up to p_to) and for the
 * same number of days just before, for the caller's organization: the
 * funder_totals() figures from 020, new people, and outcome results.
 */
create or replace function public.get_grant_numbers(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_org    uuid := current_org_id();
  v_to     date := coalesce(p_to, current_date);
  v_pfrom  date;
  v_pto    date;
  outcomes jsonb;
begin
  if v_org is null then
    raise exception 'You need to belong to an organization first.';
  end if;
  if not plan_has_feature(org_plan(v_org), 'operations') then
    raise exception 'Grant readiness is included with the Mission and Enterprise plans.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if p_from is not null and p_from > v_to then
    raise exception 'The start date must be before the end date.';
  end if;
  if p_from is not null then
    v_pto := p_from - 1;
    v_pfrom := v_pto - (v_to - p_from);
  end if;

  outcomes := outcome_summary_for_programs(v_org, p_from, v_to, null);

  return jsonb_build_object(
    'from', p_from,
    'to', v_to,
    'totals', funder_totals(v_org, p_from, v_to, '{}'::jsonb),
    'previous', case when v_pfrom is null then null else funder_totals(v_org, v_pfrom, v_pto, '{}'::jsonb) end,
    'new_people', (
      select count(*) from (
        select person_id, min(day) as first_day from (
          select sv.person_id, sv.date as day from services sv where sv.organization_id = v_org
          union all
          select fs.person_id, fs.submitted_at::date from form_submissions fs join forms f on f.id = fs.form_id
          where f.organization_id = v_org and not f.is_sample and fs.person_id is not null
        ) a group by person_id
      ) firsts
      where (p_from is null or first_day >= p_from) and first_day <= v_to),
    'outcomes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', o ->> 'label',
        'form_title', o ->> 'form_title',
        'measured', (o ->> 'people_with_followup')::int,
        'improved', (o ->> 'improved')::int,
        'same', (o ->> 'same')::int,
        'worse', (o ->> 'worse')::int))
      from jsonb_array_elements(outcomes) o
      where (o ->> 'people_with_followup')::int > 0), '[]'::jsonb)
  );
end
$$;

revoke execute on function public.get_grant_numbers(date, date) from public, anon;
grant execute on function public.get_grant_numbers(date, date) to authenticated;

commit;
