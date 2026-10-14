-- =============================================================================
-- HELP GIVEN (SERVICES), CASE NOTES AND DUPLICATE CHECKS
--
-- Run after 011_custom_fields.sql.
--
-- What this does:
--   1. Adds services: each time a person is given help (a food box, rent
--      help, a referral...), with an optional dollar value and an optional
--      inventory item. Inventory goes down when an entry with an item is
--      added and back up when it's deleted; it can't go below zero.
--   2. Adds case_notes: dated notes about a person, with who wrote them.
--      Authors can edit or delete their own notes; owners and admins can
--      delete any.
--   3. Adds find_similar_people(), used to warn before adding someone who may
--      already be on the People page (same name, email or phone).
--   4. Adds help-given totals to funder portals (get_funder_report) when the
--      "services" section is shared.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Services
-- -----------------------------------------------------------------------------

create table if not exists public.services (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  person_id         uuid not null references public.people(id) on delete cascade,
  date              date not null default current_date,
  service_type      text not null check (length(trim(service_type)) between 1 and 80),
  description       text check (description is null or length(description) <= 2000),
  value             numeric(12, 2) check (value is null or value >= 0),
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  quantity          integer check (quantity is null or quantity > 0),
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  -- An item always comes with a quantity. (The quantity stays if the item is
  -- later deleted from inventory.)
  check (inventory_item_id is null or quantity is not null)
);

create index if not exists services_organization_id_idx on public.services (organization_id, date);
create index if not exists services_person_id_idx on public.services (person_id);

drop trigger if exists set_organization_id on public.services;
create trigger set_organization_id before insert on public.services
  for each row execute function public.set_organization_id();

alter table public.services enable row level security;

drop policy if exists "Members can view" on public.services;
create policy "Members can view" on public.services for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists "Editors can add" on public.services;
create policy "Editors can add" on public.services for insert to authenticated
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Editors can change" on public.services;
create policy "Editors can change" on public.services for update to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data())
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Editors can delete" on public.services;
create policy "Editors can delete" on public.services for delete to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data());

-- The person and inventory item must belong to the same organization.
create or replace function public.check_service_links()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from people where id = new.person_id and organization_id = new.organization_id) then
    raise exception 'That person isn''t in your organization.';
  end if;
  if new.inventory_item_id is not null
     and not exists (select 1 from inventory_items where id = new.inventory_item_id and organization_id = new.organization_id) then
    raise exception 'That inventory item isn''t in your organization.';
  end if;
  return new;
end
$$;

-- Named so it runs after set_organization_id (triggers run in name order).
drop trigger if exists zz_check_service_links on public.services;
create trigger zz_check_service_links before insert or update on public.services
  for each row execute function public.check_service_links();

-- Keep inventory in step: take stock out when help is recorded, and put it
-- back when someone deletes the entry or changes its quantity or item.
-- Stock is NOT put back when the entry disappears because the person (or the
-- whole organization) was deleted, since those items were really given out,
-- or when the inventory item itself was deleted.
create or replace function public.sync_service_inventory()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  available integer;
  item_name text;
begin
  if tg_op = 'UPDATE'
     and (new.inventory_item_id is null
          or (new.inventory_item_id = old.inventory_item_id and new.quantity = old.quantity)) then
    return new;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from people where id = old.person_id) then
    return old;
  end if;

  -- Give back what the old version of the entry took.
  if tg_op in ('UPDATE', 'DELETE') and old.inventory_item_id is not null then
    update inventory_items set quantity = coalesce(quantity, 0) + old.quantity where id = old.inventory_item_id;
  end if;
  -- Take what the new version needs.
  if tg_op in ('INSERT', 'UPDATE') and new.inventory_item_id is not null then
    select coalesce(quantity, 0), name into available, item_name from inventory_items where id = new.inventory_item_id for update;
    if available < new.quantity then
      raise exception 'Only % left of "%". Lower the quantity or restock first.', available, item_name;
    end if;
    update inventory_items set quantity = available - new.quantity where id = new.inventory_item_id;
  end if;
  return coalesce(new, old);
end
$$;

drop trigger if exists sync_service_inventory on public.services;
create trigger sync_service_inventory after insert or update or delete on public.services
  for each row execute function public.sync_service_inventory();

-- -----------------------------------------------------------------------------
-- 2. Case notes
-- -----------------------------------------------------------------------------

create table if not exists public.case_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id       uuid not null references public.people(id) on delete cascade,
  body            text not null check (length(trim(body)) between 1 and 5000),
  author_id       uuid default auth.uid() references auth.users(id) on delete set null,
  -- Kept so notes still show who wrote them after that member leaves.
  author_name     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

create index if not exists case_notes_person_id_idx on public.case_notes (person_id, created_at desc);

drop trigger if exists set_organization_id on public.case_notes;
create trigger set_organization_id before insert on public.case_notes
  for each row execute function public.set_organization_id();

-- Fills in the author (from the team list), checks the person, and stamps edits.
create or replace function public.prepare_case_note()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from people where id = new.person_id and organization_id = new.organization_id) then
    raise exception 'That person isn''t in your organization.';
  end if;
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    select coalesce(nullif(trim(m.display_name), ''), m.email) into new.author_name
    from organization_members m
    where m.user_id = auth.uid() and m.organization_id = new.organization_id;
  else
    -- Authorship and the person can't be changed by an edit.
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.person_id := old.person_id;
    new.updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists zz_prepare_case_note on public.case_notes;
create trigger zz_prepare_case_note before insert or update on public.case_notes
  for each row execute function public.prepare_case_note();

alter table public.case_notes enable row level security;

drop policy if exists "Members can view" on public.case_notes;
create policy "Members can view" on public.case_notes for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists "Editors can add" on public.case_notes;
create policy "Editors can add" on public.case_notes for insert to authenticated
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Authors can edit" on public.case_notes;
create policy "Authors can edit" on public.case_notes for update to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data() and author_id = auth.uid())
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Authors and admins can delete" on public.case_notes;
create policy "Authors and admins can delete" on public.case_notes for delete to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data() and (author_id = auth.uid() or public.is_org_admin()));

-- -----------------------------------------------------------------------------
-- 3. Possible duplicates
--
-- People in the caller's organization with the same name (ignoring case,
-- spaces and punctuation), the same email, or the same phone number (digits
-- only, last 10). Runs with the caller's permissions.
-- -----------------------------------------------------------------------------

create or replace function public.find_similar_people(p_name text, p_email text default null, p_phone text default null, p_exclude uuid default null)
returns table (id uuid, full_name text, email text, phone text, program text, matched_on text)
language sql stable security invoker set search_path = public
as $$
  with input as (
    select nullif(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]', '', 'g'), '') as name_key,
           nullif(lower(trim(coalesce(p_email, ''))), '') as email_key,
           nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10), '') as phone_key
  )
  select p.id, p.full_name, p.email, p.phone, p.program,
         concat_ws(', ',
           case when regexp_replace(lower(p.full_name), '[^a-z0-9]', '', 'g') = i.name_key then 'name' end,
           case when lower(trim(p.email)) = i.email_key then 'email' end,
           case when length(i.phone_key) >= 7 and right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10) = i.phone_key then 'phone' end
         )
  from people p, input i
  where p.organization_id = public.current_org_id()
    and (p_exclude is null or p.id <> p_exclude)
    and (
      regexp_replace(lower(p.full_name), '[^a-z0-9]', '', 'g') = i.name_key
      or lower(trim(p.email)) = i.email_key
      or (length(i.phone_key) >= 7 and right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10) = i.phone_key)
    )
  limit 5
$$;

revoke execute on function public.find_similar_people(text, text, text, uuid) from public, anon;
grant execute on function public.find_similar_people(text, text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Funder portals: help given
--
-- Adds "services" to the sections a funder link can share, and wraps
-- get_funder_report so the report includes help-given totals (count,
-- people helped, value) and a breakdown by type. Never names.
-- -----------------------------------------------------------------------------

alter table public.funder_shares drop constraint if exists funder_shares_sections_check;
alter table public.funder_shares add constraint funder_shares_sections_check
  check (sections <@ array['impact', 'donations', 'volunteers', 'forms', 'goals', 'outcomes', 'services']);

-- The 010 version becomes the base; the public function adds services to it.
-- (Skipped if this script already ran.)
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'get_funder_report_base' and pronamespace = 'public'::regnamespace) then
    alter function public.get_funder_report(text) rename to get_funder_report_base;
  end if;
end $$;
revoke execute on function public.get_funder_report_base(text) from public, anon, authenticated;

create or replace function public.get_funder_report(p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  result jsonb;
  s      funder_shares;
  v_from date;
  v_to   date;
  p_from date;
  p_to   date;
begin
  result := public.get_funder_report_base(p_token);
  if result is null then
    return null;
  end if;
  select * into s from funder_shares where token = p_token;
  if not ('services' = any(s.sections)) then
    return result;
  end if;

  v_from := (result -> 'period' ->> 'from')::date;
  v_to   := (result -> 'period' ->> 'to')::date;
  p_from := (result -> 'period' ->> 'previous_from')::date;
  p_to   := (result -> 'period' ->> 'previous_to')::date;

  return result || jsonb_build_object(
    'services', jsonb_build_object(
      'count',         (select count(*) from services where organization_id = s.organization_id and (v_from is null or date >= v_from) and date <= v_to),
      'people_helped', (select count(distinct person_id) from services where organization_id = s.organization_id and (v_from is null or date >= v_from) and date <= v_to),
      'value',         coalesce((select sum(value) from services where organization_id = s.organization_id and (v_from is null or date >= v_from) and date <= v_to), 0),
      'previous', case when p_from is null then null else jsonb_build_object(
        'count',         (select count(*) from services where organization_id = s.organization_id and date between p_from and p_to),
        'people_helped', (select count(distinct person_id) from services where organization_id = s.organization_id and date between p_from and p_to),
        'value',         coalesce((select sum(value) from services where organization_id = s.organization_id and date between p_from and p_to), 0)
      ) end,
      'by_type', coalesce((
        select jsonb_agg(jsonb_build_object('name', n, 'count', c, 'value', v) order by c desc)
        from (select trim(service_type) n, count(*) c, coalesce(sum(value), 0) v from services
              where organization_id = s.organization_id and (v_from is null or date >= v_from) and date <= v_to
              group by 1) x), '[]'::jsonb),
      'by_month', coalesce((
        select jsonb_agg(jsonb_build_object('month', m, 'value', c) order by m)
        from (select to_char(date, 'YYYY-MM') m, count(*) c from services
              where organization_id = s.organization_id and (v_from is null or date >= v_from) and date <= v_to
              group by 1) x), '[]'::jsonb)
    )
  );
end
$$;

revoke execute on function public.get_funder_report(text) from public;
grant execute on function public.get_funder_report(text) to anon, authenticated;

commit;
