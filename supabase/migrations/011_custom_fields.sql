-- =============================================================================
-- CUSTOM FIELDS FOR TRACKERS
--
-- Run after 010_people_outcomes_funder_portals.sql.
--
-- What this does:
--   1. Adds tracker_settings: per organization and tracker (donations,
--      volunteer hours, inventory, links, people), its field setup:
--        labels      renamed built-in fields, e.g. {"campaign": "Fund"}
--        hidden      built-in fields the organization doesn't use
--        splitNames  ask for first and last name instead of one name
--        custom      the organization's own fields:
--                    [{"id", "label", "type", "required", "options"}]
--      Everyone in the organization can read it; owners and admins change it.
--   2. Adds a "custom" column to each tracker for the values of those fields.
--   3. Adds first_name and last_name to donations, volunteer hours and
--      people. The full name column stays as it is ("First Last"), so
--      totals, reports and search keep working.
--   4. Adds apply_name_split(), which fills first and last names from the
--      existing full names when an organization turns on split names.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Settings
-- -----------------------------------------------------------------------------

create table if not exists public.tracker_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker         text not null check (tracker in ('donations', 'volunteer_hours', 'inventory_items', 'links', 'people')),
  config          jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and length(config::text) <= 50000),
  updated_at      timestamptz not null default now(),
  updated_by      uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (organization_id, tracker)
);

drop trigger if exists set_organization_id on public.tracker_settings;
create trigger set_organization_id before insert on public.tracker_settings
  for each row execute function public.set_organization_id();

alter table public.tracker_settings enable row level security;

drop policy if exists "Members can view" on public.tracker_settings;
create policy "Members can view" on public.tracker_settings for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists "Admins can add" on public.tracker_settings;
create policy "Admins can add" on public.tracker_settings for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_org_admin());

drop policy if exists "Admins can change" on public.tracker_settings;
create policy "Admins can change" on public.tracker_settings for update to authenticated
  using (organization_id = public.current_org_id() and public.is_org_admin())
  with check (organization_id = public.current_org_id() and public.is_org_admin());

drop policy if exists "Admins can delete" on public.tracker_settings;
create policy "Admins can delete" on public.tracker_settings for delete to authenticated
  using (organization_id = public.current_org_id() and public.is_org_admin());

-- -----------------------------------------------------------------------------
-- 2. Values of custom fields
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['donations', 'volunteer_hours', 'inventory_items', 'links', 'people']
  loop
    execute format('alter table public.%I add column if not exists custom jsonb not null default ''{}''::jsonb', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_custom_is_object');
    execute format(
      'alter table public.%I add constraint %I check (jsonb_typeof(custom) = ''object'' and length(custom::text) <= 20000)',
      t, t || '_custom_is_object'
    );
  end loop;
end $$;

-- Fields that can be hidden must be allowed to stay empty on new records.
-- Some of these tables were created outside these scripts, so this checks
-- each column and only changes it if it exists and is currently required.
do $$
declare
  c record;
begin
  for c in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and is_nullable = 'NO'
      and (table_name, column_name) in (
        ('donations', 'campaign'), ('donations', 'payment_method'), ('donations', 'notes'),
        ('volunteer_hours', 'activity'), ('volunteer_hours', 'notes'),
        ('inventory_items', 'unit'), ('inventory_items', 'category'), ('inventory_items', 'condition'),
        ('inventory_items', 'location'), ('inventory_items', 'description'), ('inventory_items', 'notes'),
        ('links', 'description'), ('links', 'category')
      )
  loop
    execute format('alter table public.%I alter column %I drop not null', c.table_name, c.column_name);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. First and last names
-- -----------------------------------------------------------------------------

alter table public.donations       add column if not exists first_name text, add column if not exists last_name text;
alter table public.volunteer_hours add column if not exists first_name text, add column if not exists last_name text;
alter table public.people          add column if not exists first_name text, add column if not exists last_name text;

-- -----------------------------------------------------------------------------
-- 4. Split existing names
--
-- Runs with the caller's own permissions, so it only changes rows they're
-- allowed to edit in their own organization. Only fills rows that don't have
-- a first name yet: the first word becomes the first name and the rest the
-- last name ("Mary Ann Lee" -> "Mary" + "Ann Lee"), which people can fix.
-- Returns how many records were updated.
-- -----------------------------------------------------------------------------

create or replace function public.apply_name_split(p_tracker text)
returns integer
language plpgsql volatile security invoker set search_path = public
as $$
declare
  name_column text;
  updated     integer;
begin
  name_column := case p_tracker
    when 'donations' then 'donor_name'
    when 'volunteer_hours' then 'volunteer_name'
    when 'people' then 'full_name'
  end;
  if name_column is null then
    raise exception 'Names can only be split for donations, volunteer hours and people.';
  end if;
  if not public.is_org_admin() then
    raise exception 'Only owners and admins can change fields.';
  end if;

  execute format(
    'update public.%1$I
        set first_name = split_part(trim(%2$I), '' '', 1),
            last_name  = nullif(trim(substr(trim(%2$I), length(split_part(trim(%2$I), '' '', 1)) + 1)), '''')
      where organization_id = public.current_org_id()
        and first_name is null
        and trim(coalesce(%2$I, '''')) <> ''''',
    p_tracker, name_column
  );
  get diagnostics updated = row_count;
  return updated;
end
$$;

revoke execute on function public.apply_name_split(text) from public, anon;
grant execute on function public.apply_name_split(text) to authenticated;

commit;
