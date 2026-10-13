-- =============================================================================
-- BRANDING ON PUBLIC FORMS, DEMO SAMPLE DATA, AND TWO FIXES
--
-- Run after 004_billing.sql. It does not depend on 005.
--
-- What this does:
--   1. Lets demo visitors sign in. Anonymous users have no email, but
--      profiles.email was required, so the signup trigger failed for them.
--   2. Lets any owner or admin save branding. organization_settings.user_id
--      (who last saved it) was unique, so an admin who had their own settings
--      row from before team accounts could not save their team's branding.
--   3. Adds get_public_form_branding(), so public form pages can show the
--      organization's name, logo and color to signed-out respondents.
--   4. Adds seed_demo_data(), which fills a demo visitor's organization with
--      a sample food bank's forms, responses, donations, volunteer hours,
--      inventory and links, so the demo shows a working app.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Demo sign-ins
-- -----------------------------------------------------------------------------

alter table public.profiles alter column email drop not null;

-- -----------------------------------------------------------------------------
-- 2. Branding saves by any admin
-- -----------------------------------------------------------------------------

alter table public.organization_settings drop constraint if exists organization_settings_user_id_key;

-- -----------------------------------------------------------------------------
-- 3. Branding for public forms
--
-- Only for published, non-archived forms, and only what the form page shows.
-- -----------------------------------------------------------------------------

create or replace function public.get_public_form_branding(p_form_id uuid)
returns table (organization_name text, primary_color text, logo_url text)
language sql stable security definer set search_path = public
as $$
  select o.name, s.primary_color, s.logo_url
  from forms f
  join organizations o on o.id = f.organization_id
  left join organization_settings s on s.organization_id = f.organization_id
  where f.id = p_form_id and f.is_published = true and coalesce(f.is_archived, false) = false
$$;

grant execute on function public.get_public_form_branding(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Demo sample data
--
-- Called by the /demo page right after it creates the visitor's organization.
-- Only works for demo (anonymous) owners, and only fills an empty
-- organization, so calling it twice does nothing.
-- Dates are relative to today so the charts always look current.
-- -----------------------------------------------------------------------------

create or replace function public.seed_demo_data()
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
  if v_user is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false then
    raise exception 'Sample data is only for demo accounts.';
  end if;
  if v_org is null or current_org_role() <> 'owner' then
    raise exception 'Create the demo organization first.';
  end if;
  if exists (select 1 from forms where organization_id = v_org) then
    return;
  end if;

  -- ----- Branding -----
  insert into organization_settings (organization_id, user_id, primary_color)
  values (v_org, v_user, '#0f766e')
  on conflict (organization_id) do nothing;

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
end
$$;

revoke execute on function public.seed_demo_data() from public, anon;
grant execute on function public.seed_demo_data() to authenticated;

commit;
