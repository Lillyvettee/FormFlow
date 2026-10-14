-- =============================================================================
-- SAMPLE DATA FOR REAL ACCOUNTS (REPLACES THE GUEST DEMO)
--
-- Run after 006_branding_and_demo_data.sql. It does not depend on 005 or 007.
--
-- What this does:
--   1. Adds is_sample to forms, donations, volunteer_hours, inventory_items
--      and links, so sample records can be told apart from real ones.
--   2. Adds load_sample_data(): an owner or admin of an empty organization
--      can fill it with the sample food bank's records from 006.
--   3. Adds clear_sample_data(): removes every sample record (and the sample
--      forms' responses) and leaves real records alone.
--   4. Adds sample_data_status(), which the dashboard uses to decide which
--      button to show.
--   5. Removes the guest demo: seed_demo_data(), and the demo discount codes
--      (demo_codes, get_my_demo_code(), organization_billing.discount_code).
--      The demo needed anonymous sign-ins, which are off. Discounts now use
--      Stripe promotion codes, entered at checkout.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Sample flag
-- -----------------------------------------------------------------------------

alter table public.forms           add column if not exists is_sample boolean not null default false;
alter table public.donations       add column if not exists is_sample boolean not null default false;
alter table public.volunteer_hours add column if not exists is_sample boolean not null default false;
alter table public.inventory_items add column if not exists is_sample boolean not null default false;
alter table public.links           add column if not exists is_sample boolean not null default false;

-- -----------------------------------------------------------------------------
-- 2. Status: 'empty' (nothing yet), 'sample' (has sample records) or 'none'
-- -----------------------------------------------------------------------------

create or replace function public.sample_data_status()
returns text
language sql stable security definer set search_path = public
as $$
  with o as (select public.current_org_id() as id)
  select case
    when (select id from o) is null then 'none'
    when exists (select 1 from forms           where organization_id = (select id from o) and is_sample)
      or exists (select 1 from donations       where organization_id = (select id from o) and is_sample)
      or exists (select 1 from volunteer_hours where organization_id = (select id from o) and is_sample)
      or exists (select 1 from inventory_items where organization_id = (select id from o) and is_sample)
      or exists (select 1 from links           where organization_id = (select id from o) and is_sample)
      then 'sample'
    when not exists (select 1 from forms           where organization_id = (select id from o))
     and not exists (select 1 from donations       where organization_id = (select id from o))
     and not exists (select 1 from volunteer_hours where organization_id = (select id from o))
     and not exists (select 1 from inventory_items where organization_id = (select id from o))
     and not exists (select 1 from links           where organization_id = (select id from o))
      then 'empty'
    else 'none'
  end
$$;

revoke execute on function public.sample_data_status() from public, anon;
grant execute on function public.sample_data_status() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Load
--
-- Only fills an empty organization, so real records never get mixed in with
-- sample ones and calling it twice does nothing. Dates are relative to today
-- so the charts look current.
-- -----------------------------------------------------------------------------

create or replace function public.load_sample_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_org    uuid := current_org_id();
  v_intake uuid := gen_random_uuid();
  v_signup uuid := gen_random_uuid();
  v_survey uuid := gen_random_uuid();
  d        date := current_date;
begin
  if v_org is null or coalesce(current_org_role() in ('owner', 'admin'), false) = false then
    raise exception 'Only owners and admins can add sample data.';
  end if;
  if not org_has_access(v_org) then
    raise exception 'Your organization is read-only. Subscribe to add data.';
  end if;
  if sample_data_status() <> 'empty' then
    return;
  end if;

  -- ----- Forms -----
  insert into forms (id, organization_id, user_id, title, description, fields, settings, is_published) values
  (v_intake, v_org, v_user, 'Client Intake',
   'Welcome to Riverside Food Bank. This helps us serve your household.',
   '[{"id":"name","type":"text","label":"Full name","placeholder":"","required":true,"options":[]},
     {"id":"household","type":"number","label":"People in household","placeholder":"","required":true,"options":[]},
     {"id":"zip","type":"text","label":"ZIP code","placeholder":"","required":false,"options":[]},
     {"id":"needs","type":"select","label":"What do you need most?","placeholder":"","required":false,"options":["Groceries","Baby supplies","Hygiene items","Hot meals"]},
     {"id":"notes","type":"textarea","label":"Anything else we should know?","placeholder":"","required":false,"options":[]}]'::jsonb,
   '{}'::jsonb, true),
  (v_signup, v_org, v_user, 'Volunteer Sign-Up',
   'Join us for a shift. We''ll email you to confirm.',
   '[{"id":"name","type":"text","label":"Your name","placeholder":"","required":true,"options":[]},
     {"id":"email","type":"email","label":"Email","placeholder":"","required":true,"options":[]},
     {"id":"shift","type":"select","label":"Preferred shift","placeholder":"","required":true,"options":["Saturday morning","Tuesday evening","Thursday delivery route"]},
     {"id":"first_time","type":"checkbox","label":"This is my first time volunteering with us","placeholder":"","required":false,"options":[]}]'::jsonb,
   '{}'::jsonb, true),
  (v_survey, v_org, v_user, 'Community Needs Survey',
   'Draft: not published yet.',
   '[{"id":"rating","type":"select","label":"How easy was it to get help today?","placeholder":"","required":true,"options":["Very easy","Easy","Hard","Very hard"]},
     {"id":"photo","type":"image","label":"Share a photo (optional)","placeholder":"","required":false,"options":[]}]'::jsonb,
   '{}'::jsonb, false);

  -- ----- Form responses (spread over the last 30 days) -----
  insert into form_submissions (form_id, data, submitted_at)
  select v_intake,
         jsonb_build_object('name', n, 'household', h, 'zip', z, 'needs', need),
         now() - make_interval(days => ago, hours => ago % 7)
  from (values
    ('Maria Lopez', 4, '78701', 'Groceries', 1),
    ('James Carter', 2, '78702', 'Hot meals', 2),
    ('Aisha Khan', 5, '78704', 'Baby supplies', 3),
    ('Tom Nguyen', 1, '78701', 'Groceries', 5),
    ('Rosa Martinez', 3, '78745', 'Hygiene items', 6),
    ('Dev Patel', 6, '78702', 'Groceries', 9),
    ('Grace Kim', 2, '78704', 'Hot meals', 12),
    ('Luis Hernandez', 4, '78741', 'Groceries', 15),
    ('Nora Smith', 1, '78701', 'Hygiene items', 19),
    ('Omar Ali', 3, '78745', 'Baby supplies', 24),
    ('Beth Jones', 5, '78702', 'Groceries', 28)
  ) as t(n, h, z, need, ago);

  insert into form_submissions (form_id, data, submitted_at)
  select v_signup,
         jsonb_build_object('name', n, 'email', e, 'shift', s, 'first_time', ft),
         now() - make_interval(days => ago)
  from (values
    ('Sam Lee', 'sam@example.com', 'Saturday morning', true, 2),
    ('Priya Shah', 'priya@example.com', 'Tuesday evening', false, 4),
    ('Chris Brown', 'chris@example.com', 'Thursday delivery route', true, 8),
    ('Ana Torres', 'ana@example.com', 'Saturday morning', false, 13)
  ) as t(n, e, s, ft, ago);

  -- ----- Donations -----
  insert into donations (organization_id, user_id, donor_name, amount, date, campaign, payment_method, notes)
  select v_org, v_user, n, amt, d - ago, c, pm, nt
  from (values
    ('Hill Country Grocers', 2500.00, 3, 'Holiday Food Drive', 'Check', 'Annual corporate gift'),
    ('Maria Lopez', 50.00, 5, 'General Fund', 'Credit Card', null),
    ('First Community Church', 750.00, 9, 'Holiday Food Drive', 'Check', null),
    ('Anonymous', 100.00, 12, 'General Fund', 'Cash', null),
    ('Dev Patel', 25.00, 16, 'Backpack Program', 'Venmo', null),
    ('Rotary Club of Riverside', 1200.00, 21, 'Backpack Program', 'Bank Transfer', 'Matched by members'),
    ('Grace Kim', 40.00, 27, 'General Fund', 'PayPal', null),
    ('Riverside Credit Union', 1000.00, 35, 'General Fund', 'Bank Transfer', null),
    ('Tom Nguyen', 75.00, 48, 'Backpack Program', 'Credit Card', null),
    ('Local Lions Club', 500.00, 63, 'Holiday Food Drive', 'Check', null),
    ('Beth Jones', 30.00, 77, 'General Fund', 'Cash', null),
    ('Austin Family Foundation', 5000.00, 92, 'General Fund', 'Bank Transfer', 'Operating grant')
  ) as t(n, amt, ago, c, pm, nt);

  -- ----- Volunteer hours -----
  insert into volunteer_hours (organization_id, user_id, volunteer_name, activity, hours, date, notes)
  select v_org, v_user, n, a, h, d - ago, null
  from (values
    ('Sam Lee', 'Food sorting', 3.0, 1),
    ('Priya Shah', 'Distribution', 4.0, 1),
    ('Ana Torres', 'Delivery route', 2.5, 3),
    ('Chris Brown', 'Food sorting', 3.0, 6),
    ('Sam Lee', 'Distribution', 4.0, 8),
    ('Priya Shah', 'Front desk', 2.0, 10),
    ('Ana Torres', 'Delivery route', 2.5, 13),
    ('Marcus Reed', 'Food sorting', 5.0, 15),
    ('Sam Lee', 'Food sorting', 3.0, 22),
    ('Chris Brown', 'Distribution', 4.0, 29),
    ('Marcus Reed', 'Delivery route', 3.5, 36),
    ('Priya Shah', 'Distribution', 4.0, 43),
    ('Ana Torres', 'Front desk', 2.0, 57),
    ('Sam Lee', 'Distribution', 4.0, 71)
  ) as t(n, a, h, ago);

  -- ----- Inventory (a few low on stock, to show the alerts) -----
  insert into inventory_items (organization_id, user_id, name, quantity, unit, category, condition, location, low_stock_threshold)
  values
    (v_org, v_user, 'Canned vegetables', 340, 'cans', 'Food', 'new', 'Shelf A', 50),
    (v_org, v_user, 'Peanut butter', 18, 'jars', 'Food', 'new', 'Shelf A', 25),
    (v_org, v_user, 'Rice (5 lb bags)', 64, 'bags', 'Food', 'new', 'Shelf B', 20),
    (v_org, v_user, 'Baby formula', 4, 'cans', 'Baby supplies', 'new', 'Cabinet 2', 10),
    (v_org, v_user, 'Diapers (size 3)', 22, 'packs', 'Baby supplies', 'new', 'Cabinet 2', 10),
    (v_org, v_user, 'Toothpaste', 0, 'tubes', 'Hygiene', 'new', 'Cabinet 1', 15),
    (v_org, v_user, 'Grocery bags', 500, 'bags', 'Supplies', 'good', 'Back room', 100),
    (v_org, v_user, 'Folding tables', 6, 'tables', 'Equipment', 'fair', 'Storage', 2);

  -- ----- Links -----
  insert into links (organization_id, user_id, title, url, description, category)
  values
    (v_org, v_user, 'Feeding America', 'https://www.feedingamerica.org', 'National food bank network', 'Partners'),
    (v_org, v_user, 'Grants.gov', 'https://www.grants.gov', 'Federal grant search', 'Grants'),
    (v_org, v_user, 'SNAP eligibility', 'https://www.fns.usda.gov/snap/recipient/eligibility', 'Share with clients who may qualify', 'Client resources');

  -- ----- Mark everything above as sample (the organization was empty) -----
  update forms           set is_sample = true where organization_id = v_org;
  update donations       set is_sample = true where organization_id = v_org;
  update volunteer_hours set is_sample = true where organization_id = v_org;
  update inventory_items set is_sample = true where organization_id = v_org;
  update links           set is_sample = true where organization_id = v_org;
end
$$;

revoke execute on function public.load_sample_data() from public, anon;
grant execute on function public.load_sample_data() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Clear
--
-- Sample forms' responses go with them (form_submissions cascades).
-- -----------------------------------------------------------------------------

create or replace function public.clear_sample_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := current_org_id();
begin
  if v_org is null or coalesce(current_org_role() in ('owner', 'admin'), false) = false then
    raise exception 'Only owners and admins can remove sample data.';
  end if;

  delete from forms           where organization_id = v_org and is_sample;
  delete from donations       where organization_id = v_org and is_sample;
  delete from volunteer_hours where organization_id = v_org and is_sample;
  delete from inventory_items where organization_id = v_org and is_sample;
  delete from links           where organization_id = v_org and is_sample;
end
$$;

revoke execute on function public.clear_sample_data() from public, anon;
grant execute on function public.clear_sample_data() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Retire the guest demo and its discount codes
-- -----------------------------------------------------------------------------

drop function if exists public.seed_demo_data();
drop function if exists public.get_my_demo_code();
drop table if exists public.demo_codes;
alter table public.organization_billing drop column if exists discount_code;

commit;
