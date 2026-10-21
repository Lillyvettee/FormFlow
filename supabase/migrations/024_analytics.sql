-- =============================================================================
-- ANALYTICS: STOCK HISTORY, TARGET LEVELS AND get_analytics()
--
-- Run after 023_card_design.sql.
--
-- Mission and Enterprise only (plan feature 'analytics').
--
-- What this does:
--   1. inventory_movements: every change to an item's stock, with why
--      (reason) and who. A trigger on inventory_items writes it, so every
--      path is covered: Help given, the scanner, the +/- buttons, edits,
--      imports and new items. Reasons:
--        help_given          taken out by a Help given entry
--        help_given_return   put back when that entry was deleted or changed
--        scan_receive        Scan page, Receive
--        scan_give           Scan page, Give out
--        created             a new item's starting quantity
--        edit                any other change (+/- buttons, the item form)
--      Existing Help given entries with items are copied in once, so usage
--      history starts with what's already recorded.
--   2. inventory_items.target_quantity: an optional stock level to keep.
--   3. get_analytics(): everything the Analytics page shows, worked out in
--      the database: inventory usage, demand and visits, fundraising and
--      volunteer coverage. Counts and totals only.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Plan feature
--
-- Replaces the version from 022, adding 'analytics'.
-- -----------------------------------------------------------------------------

create or replace function public.plan_has_feature(p_plan text, p_feature text)
returns boolean
language sql immutable
as $$
  select p_plan in ('mission', 'enterprise')
     and p_feature in ('import_export', 'branding', 'funder_advanced', 'cards_scanning', 'analytics')
$$;

-- -----------------------------------------------------------------------------
-- 2. Target level
-- -----------------------------------------------------------------------------

alter table public.inventory_items
  add column if not exists target_quantity integer check (target_quantity is null or target_quantity >= 0);

-- -----------------------------------------------------------------------------
-- 3. Stock history
-- -----------------------------------------------------------------------------

create table if not exists public.inventory_movements (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id         uuid not null references public.inventory_items(id) on delete cascade,
  -- Positive = into stock, negative = out of stock.
  delta           integer not null,
  -- Stock after the change (null for history copied from older records).
  quantity_after  integer,
  reason          text not null check (reason in ('help_given', 'help_given_return', 'scan_receive', 'scan_give', 'created', 'edit')),
  -- The Help given entry behind it, if any.
  service_id      uuid,
  actor_id        uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists inventory_movements_item_idx on public.inventory_movements (item_id, created_at);
create index if not exists inventory_movements_org_idx on public.inventory_movements (organization_id, created_at);

alter table public.inventory_movements enable row level security;

-- Read-only for members; only the trigger below writes it.
drop policy if exists "Members can view" on public.inventory_movements;
create policy "Members can view" on public.inventory_movements for select to authenticated
  using (organization_id = public.current_org_id());

-- Records a stock change. The functions that change stock say why by setting
-- app.stock_reason (and app.stock_service) just before; anything else is an
-- edit, or 'created' for a new item.
create or replace function public.log_inventory_movement()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_delta integer := coalesce(new.quantity, 0) - case when tg_op = 'UPDATE' then coalesce(old.quantity, 0) else 0 end;
begin
  if v_delta = 0 or new.is_sample or current_setting('app.moving_org', true) = 'on' then
    return new;
  end if;
  insert into inventory_movements (organization_id, item_id, delta, quantity_after, reason, service_id, actor_id)
  values (
    new.organization_id, new.id, v_delta, new.quantity,
    coalesce(nullif(current_setting('app.stock_reason', true), ''), case when tg_op = 'INSERT' then 'created' else 'edit' end),
    nullif(current_setting('app.stock_service', true), '')::uuid,
    auth.uid()
  );
  return new;
end
$$;

-- "zz" so it runs after set_organization_id on insert. AFTER, so it sees the saved row.
drop trigger if exists zz_log_inventory_movement on public.inventory_items;
create trigger zz_log_inventory_movement after insert or update of quantity on public.inventory_items
  for each row execute function public.log_inventory_movement();

revoke execute on function public.log_inventory_movement() from public, anon, authenticated;

-- Replaces the version from 012: the same, plus it labels its stock changes.
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
    perform set_config('app.stock_reason', 'help_given_return', true);
    perform set_config('app.stock_service', old.id::text, true);
    update inventory_items set quantity = coalesce(quantity, 0) + old.quantity where id = old.inventory_item_id;
  end if;
  -- Take what the new version needs.
  if tg_op in ('INSERT', 'UPDATE') and new.inventory_item_id is not null then
    select coalesce(quantity, 0), name into available, item_name from inventory_items where id = new.inventory_item_id for update;
    if available < new.quantity then
      raise exception 'Only % left of "%". Lower the quantity or restock first.', available, item_name;
    end if;
    perform set_config('app.stock_reason', 'help_given', true);
    perform set_config('app.stock_service', new.id::text, true);
    update inventory_items set quantity = available - new.quantity where id = new.inventory_item_id;
  end if;
  perform set_config('app.stock_reason', '', true);
  perform set_config('app.stock_service', '', true);
  return coalesce(new, old);
end
$$;

-- Replaces the version from 022: the same, plus it labels its stock change.
create or replace function public.adjust_inventory(p_item_id uuid, p_delta integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_org  uuid := current_org_id();
  v_item inventory_items%rowtype;
  v_new  integer;
begin
  if v_org is null or not can_edit_org_data() then
    raise exception 'You can''t change stock right now.';
  end if;
  if not plan_has_feature(org_plan(v_org), 'cards_scanning') then
    raise exception 'Scanning is included with the Mission and Enterprise plans.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'Enter a quantity between 1 and 100,000.';
  end if;

  select * into v_item from inventory_items where id = p_item_id and organization_id = v_org for update;
  if not found then
    raise exception 'That item isn''t in your inventory.';
  end if;
  v_new := coalesce(v_item.quantity, 0) + p_delta;
  if v_new < 0 then
    raise exception 'Only % left of "%".', coalesce(v_item.quantity, 0), v_item.name;
  end if;
  perform set_config('app.stock_reason', case when p_delta > 0 then 'scan_receive' else 'scan_give' end, true);
  update inventory_items set quantity = v_new where id = p_item_id;
  perform set_config('app.stock_reason', '', true);
  return v_new;
end
$$;

-- History so far: Help given entries that took items (once; skipped if already copied).
insert into public.inventory_movements (organization_id, item_id, delta, quantity_after, reason, service_id, actor_id, created_at)
select s.organization_id, s.inventory_item_id, -s.quantity, null, 'help_given', s.id, s.created_by,
       coalesce(s.date::timestamptz, s.created_at)
from public.services s
join public.inventory_items i on i.id = s.inventory_item_id and not i.is_sample
where s.inventory_item_id is not null and s.quantity is not null
  and not exists (select 1 from public.inventory_movements m where m.service_id = s.id);

-- -----------------------------------------------------------------------------
-- 4. get_analytics()
-- -----------------------------------------------------------------------------

/**
 * Everything the Analytics page shows, for the caller's organization.
 * Usage counts stock that went out (help given, scanner give-outs, and
 * decreases from edits or the +/- buttons), less anything put back from a
 * deleted Help given entry. Sample records are left out.
 */
create or replace function public.get_analytics()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_org      uuid := current_org_id();
  v_today    date := current_date;
  v_year     date := date_trunc('year', current_date)::date;
  v_months   date := (date_trunc('month', current_date) - interval '11 months')::date;
  v_90       date := current_date - 89;
  result     jsonb;
begin
  if v_org is null then
    raise exception 'You need to belong to an organization first.';
  end if;
  if not plan_has_feature(org_plan(v_org), 'analytics') then
    raise exception 'Analytics is included with the Mission and Enterprise plans.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;

  with
  -- ----- Inventory -----
  usage as (
    select m.item_id, m.created_at::date as day,
           case
             when m.delta < 0 and m.reason in ('help_given', 'scan_give', 'edit') then -m.delta
             when m.reason = 'help_given_return' then -m.delta
             else 0
           end as used,
           case when m.delta > 0 and m.reason in ('scan_receive', 'edit', 'created') then m.delta else 0 end as received
    from inventory_movements m
    where m.organization_id = v_org and m.created_at >= v_today - 364
  ),
  items as (
    select i.id, i.name, i.unit, i.category, coalesce(i.quantity, 0) as quantity, i.target_quantity,
           coalesce((select sum(u.used) from usage u where u.item_id = i.id and u.day >= v_today - 29), 0) as used_30,
           coalesce((select sum(u.used) from usage u where u.item_id = i.id and u.day >= v_90), 0) as used_90,
           coalesce((select sum(u.received) from usage u where u.item_id = i.id and u.day >= v_90), 0) as received_90,
           -- Days of history behind the 90-day figures (fewer for new items).
           least(90, greatest(1, v_today - least(
             i.created_at::date,
             coalesce((select min(m.created_at)::date from inventory_movements m where m.item_id = i.id), i.created_at::date)
           ) + 1)) as history_days,
           (select max(u.day) from usage u where u.item_id = i.id and u.used > 0) as last_used
    from inventory_items i
    where i.organization_id = v_org and not i.is_sample
  ),
  weekly_usage as (
    select date_trunc('week', day)::date as week, sum(used) as used
    from usage where day >= date_trunc('week', v_today)::date - 77
    group by 1
  ),
  -- ----- People served: any help given or form response linked to a person -----
  activity as (
    select sv.person_id, sv.date as day from services sv where sv.organization_id = v_org
    union all
    select fs.person_id, fs.submitted_at::date
    from form_submissions fs join forms f on f.id = fs.form_id
    where f.organization_id = v_org and not f.is_sample and fs.person_id is not null
  ),
  first_seen as (
    select person_id, min(day) as first_day from activity group by person_id
  ),
  -- ----- Months for the last 12 months -----
  months as (
    select generate_series(v_months, date_trunc('month', v_today)::date, interval '1 month')::date as month
  )
  select jsonb_build_object(
    'generated_at', now(),

    'inventory', jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', id, 'name', name, 'unit', unit, 'category', category, 'quantity', quantity,
          'target_quantity', target_quantity, 'used_30', used_30, 'used_90', used_90,
          'received_90', received_90, 'history_days', history_days, 'last_used', last_used
        ) order by name) from items), '[]'::jsonb),
      'weekly_usage', coalesce((select jsonb_agg(jsonb_build_object('week', w.week, 'used', coalesce(u.used, 0)) order by w.week)
        from (select generate_series(date_trunc('week', v_today)::date - 77, date_trunc('week', v_today)::date, interval '1 week')::date as week) w
        left join weekly_usage u on u.week = w.week), '[]'::jsonb),
      'tracking_since', (select min(created_at) from inventory_movements where organization_id = v_org)
    ),

    'demand', jsonb_build_object(
      'by_month', coalesce((select jsonb_agg(jsonb_build_object(
          'month', to_char(mo.month, 'YYYY-MM'),
          'people', (select count(distinct a.person_id) from activity a where date_trunc('month', a.day) = mo.month),
          'new_people', (select count(*) from first_seen fs where date_trunc('month', fs.first_day) = mo.month),
          'help_given', (select count(*) from services sv where sv.organization_id = v_org and date_trunc('month', sv.date) = mo.month)
        ) order by mo.month) from months mo), '[]'::jsonb),
      -- Last 90 days: visits = distinct person-days; ISO weekday 1 = Monday.
      'by_weekday', coalesce((select jsonb_agg(jsonb_build_object(
          'weekday', d,
          'visits', (select count(*) from (select distinct person_id, day from activity where day >= v_90) x where extract(isodow from x.day) = d),
          'help_given', (select count(*) from services sv where sv.organization_id = v_org and sv.date >= v_90 and extract(isodow from sv.date) = d)
        ) order by d) from generate_series(1, 7) d), '[]'::jsonb),
      'people_90', (select count(distinct person_id) from activity where day >= v_90),
      'people_prev_90', (select count(distinct person_id) from activity where day between v_90 - 90 and v_90 - 1),
      'new_90', (select count(*) from first_seen where first_day >= v_90)
    ),

    'fundraising', jsonb_build_object(
      'by_month', coalesce((select jsonb_agg(jsonb_build_object(
          'month', m,
          'this_year', coalesce((select sum(amount) from donations where organization_id = v_org and not is_sample
                                  and date >= v_year and extract(month from date) = m), 0),
          'last_year', coalesce((select sum(amount) from donations where organization_id = v_org and not is_sample
                                  and date >= (v_year - interval '1 year')::date and date < v_year and extract(month from date) = m), 0)
        ) order by m) from generate_series(1, 12) m), '[]'::jsonb),
      'ytd', coalesce((select sum(amount) from donations where organization_id = v_org and not is_sample and date between v_year and v_today), 0),
      'last_ytd', coalesce((select sum(amount) from donations where organization_id = v_org and not is_sample
                             and date between (v_year - interval '1 year')::date and (v_today - interval '1 year')::date), 0),
      'last_year_total', coalesce((select sum(amount) from donations where organization_id = v_org and not is_sample
                                    and date >= (v_year - interval '1 year')::date and date < v_year), 0),
      'gifts_ytd', (select count(*) from donations where organization_id = v_org and not is_sample and date between v_year and v_today),
      'donors_ytd', (select count(distinct lower(trim(donor_name))) from donations where organization_id = v_org and not is_sample and date between v_year and v_today),
      'donors_last_year', (select count(distinct lower(trim(donor_name))) from donations where organization_id = v_org and not is_sample
                            and date >= (v_year - interval '1 year')::date and date < v_year),
      'retained_donors', (select count(*) from (
          select lower(trim(donor_name)) from donations where organization_id = v_org and not is_sample
            and date >= (v_year - interval '1 year')::date and date < v_year
          intersect
          select lower(trim(donor_name)) from donations where organization_id = v_org and not is_sample and date between v_year and v_today
        ) r),
      'day_of_year', extract(doy from v_today),
      'days_in_year', extract(doy from (date_trunc('year', v_today) + interval '1 year - 1 day')::date)
    ),

    'volunteers', jsonb_build_object(
      'by_weekday', coalesce((select jsonb_agg(jsonb_build_object(
          'weekday', d,
          'hours', coalesce((select sum(hours) from volunteer_hours where organization_id = v_org and not is_sample
                              and date >= v_90 and extract(isodow from date) = d), 0)
        ) order by d) from generate_series(1, 7) d), '[]'::jsonb),
      'by_month', coalesce((select jsonb_agg(jsonb_build_object(
          'month', to_char(mo.month, 'YYYY-MM'),
          'hours', coalesce((select sum(hours) from volunteer_hours where organization_id = v_org and not is_sample
                              and date_trunc('month', date) = mo.month), 0)
        ) order by mo.month) from months mo), '[]'::jsonb)
    )
  ) into result;

  return result;
end
$$;

revoke execute on function public.get_analytics() from public, anon;
grant execute on function public.get_analytics() to authenticated;

commit;
