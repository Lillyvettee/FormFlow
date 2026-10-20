-- =============================================================================
-- PLANS AND LIMITS: STARTER, MISSION AND ENTERPRISE
--
-- Run after 015_people_access_and_history.sql.
--
-- What this does:
--   1. Allows plan = 'enterprise' in organization_billing. Enterprise has no
--      Stripe price: after a sales conversation, set it by hand (see the end
--      of this file).
--   2. Adds org_plan(), plan_limit() and plan_has_feature(), the one place
--      the database keeps each plan's limits:
--
--                          Starter   Mission   Enterprise
--        Active forms           50       100   unlimited
--        Team members            2        10   unlimited   (includes the owner
--                                                           and open invitations)
--        Client profiles       200       500   unlimited   (People)
--        PDF reports / month    50       100   unlimited
--        Import and export       -       yes   yes
--        Custom branding         -       yes   yes
--
--      During the free trial an organization gets Mission's limits.
--   3. Refuses new forms, people, members and invitations past the limit.
--      Records that already exist are never removed.
--   4. Counts PDF report exports per calendar month (use_report_export).
--   5. Stops Starter organizations from changing their logo and color, and
--      tells the public form page not to show saved branding or per-form
--      colors and logos for them.
--   6. Adds get_plan_usage() for the Plan card in Settings.
--   7. Adds enterprise_inquiries, written only by the enterprise-inquiry
--      function (with the service role key).
--
-- CSV import and export run in the browser on records the person can already
-- see, so the app hides them on Starter; the database can't tell an import
-- from records added one at a time.
--
-- Keep the numbers in step with client/src/lib/plans.ts.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Enterprise plan
-- -----------------------------------------------------------------------------

alter table public.organization_billing drop constraint if exists organization_billing_plan_check;
alter table public.organization_billing
  add constraint organization_billing_plan_check check (plan in ('starter', 'mission', 'enterprise'));

-- -----------------------------------------------------------------------------
-- 2. Plans, limits and features
-- -----------------------------------------------------------------------------

-- The plan whose limits apply: the subscribed plan, or Mission during the
-- free trial (and after it, when the organization is read-only anyway).
create or replace function public.org_plan(p_org uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when b.status in ('active', 'trialing', 'past_due') then coalesce(b.plan, 'starter')
      else 'mission'
    end
    from organization_billing b
    where b.organization_id = p_org
  ), 'mission')
$$;

-- A plan's limit for one resource, or null for unlimited.
-- Resources: 'forms', 'members', 'people', 'reports' (PDF exports per month).
create or replace function public.plan_limit(p_plan text, p_resource text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'starter' then case p_resource
      when 'forms'   then 50
      when 'members' then 2
      when 'people'  then 200
      when 'reports' then 50
    end
    when 'mission' then case p_resource
      when 'forms'   then 100
      when 'members' then 10
      when 'people'  then 500
      when 'reports' then 100
    end
  end
$$;

-- Features: 'import_export', 'branding'. Starter has neither.
create or replace function public.plan_has_feature(p_plan text, p_feature text)
returns boolean
language sql immutable
as $$
  select p_plan in ('mission', 'enterprise') and p_feature in ('import_export', 'branding')
$$;

-- PDF reports exported per organization per calendar month. No policies:
-- read through get_plan_usage(), written by use_report_export().
create table if not exists public.report_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month           date not null,
  used            integer not null default 0,
  primary key (organization_id, month)
);

alter table public.report_usage enable row level security;

-- How many of a resource an organization has now.
create or replace function public.plan_usage(p_org uuid, p_resource text)
returns integer
language sql stable security definer set search_path = public
as $$
  select case p_resource
    when 'forms' then (
      select count(*) from forms where organization_id = p_org and coalesce(is_archived, false) = false)
    when 'members' then (
      select count(*) from organization_members where organization_id = p_org)
      + (select count(*) from organization_invitations
         where organization_id = p_org and accepted_at is null and expires_at > now())
    when 'people' then (
      select count(*) from people where organization_id = p_org)
    when 'reports' then coalesce((
      select used from report_usage
      where organization_id = p_org and month = date_trunc('month', now())::date), 0)
  end::integer
$$;

-- -----------------------------------------------------------------------------
-- 3. Refuse new records past the limit
--
-- The triggers are named zz_plan_limit so they run after set_organization_id
-- (Postgres runs BEFORE triggers in name order). The lock makes two adds at
-- the same moment wait for each other, so they can't both squeeze in.
-- -----------------------------------------------------------------------------

create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_resource text := tg_argv[0];
  v_label    text := tg_argv[1];
  v_plan     text;
  v_limit    integer;
  v_used     integer;
begin
  -- Forms only count while active, so unarchiving one counts as adding it.
  if tg_table_name = 'forms' then
    if coalesce(new.is_archived, false) then return new; end if;
    if tg_op = 'UPDATE' and not coalesce(old.is_archived, false) then return new; end if;
  end if;

  v_plan := org_plan(new.organization_id);
  v_limit := plan_limit(v_plan, v_resource);
  if v_limit is null then return new; end if;

  perform pg_advisory_xact_lock(hashtext('plan_limit:' || new.organization_id || ':' || v_resource));

  v_used := plan_usage(new.organization_id, v_resource);
  -- Accepting an invitation turns an open invitation into a member, so the
  -- invitation being accepted is already counted.
  if tg_table_name = 'organization_members' then
    v_used := v_used - (select count(*) from organization_invitations
                        where organization_id = new.organization_id and accepted_at is null
                          and expires_at > now() and lower(email) = lower(coalesce(new.email, '')));
  end if;

  if v_used >= v_limit then
    raise exception 'Your % plan includes % %. Upgrade your plan in Settings to add more.',
      initcap(v_plan), v_limit, v_label
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end
$$;

drop trigger if exists zz_plan_limit on public.forms;
create trigger zz_plan_limit before insert or update of is_archived on public.forms
  for each row execute function public.enforce_plan_limit('forms', 'active forms');

drop trigger if exists zz_plan_limit on public.people;
create trigger zz_plan_limit before insert on public.people
  for each row execute function public.enforce_plan_limit('people', 'client profiles');

drop trigger if exists zz_plan_limit on public.organization_members;
create trigger zz_plan_limit before insert on public.organization_members
  for each row execute function public.enforce_plan_limit('members', 'team members');

drop trigger if exists zz_plan_limit on public.organization_invitations;
create trigger zz_plan_limit before insert on public.organization_invitations
  for each row execute function public.enforce_plan_limit('members', 'team members');

-- -----------------------------------------------------------------------------
-- 4. PDF reports per month
--
-- report_usage is created in section 2, because plan_usage() reads it.
-- -----------------------------------------------------------------------------

-- Counts one PDF report for the caller's organization and returns how many
-- are left this month (null for unlimited). Refuses once the month's
-- reports are used up. Viewers and read-only organizations can still
-- export, as before; they just count too.
create or replace function public.use_report_export()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_org   uuid := current_org_id();
  v_plan  text;
  v_limit integer;
  v_used  integer;
begin
  if v_org is null then
    raise exception 'You need to belong to an organization first.';
  end if;
  v_plan := org_plan(v_org);
  v_limit := plan_limit(v_plan, 'reports');

  insert into report_usage as r (organization_id, month, used)
  values (v_org, date_trunc('month', now())::date, 1)
  on conflict (organization_id, month) do update set used = r.used + 1
    where v_limit is null or r.used < v_limit
  returning used into v_used;

  if v_used is null then
    raise exception 'Your % plan includes % PDF reports a month, and this month''s are used up. They reset on the 1st, or upgrade your plan in Settings.',
      initcap(v_plan), v_limit
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return case when v_limit is null then null else v_limit - v_used end;
end
$$;

revoke execute on function public.use_report_export() from public, anon;
grant execute on function public.use_report_export() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Custom branding is Mission and Enterprise only
-- -----------------------------------------------------------------------------

create or replace function public.enforce_branding_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    -- '#6366f1' is the column's default color from 001.
    v_changed := new.logo_url is not null or coalesce(new.primary_color, '#6366f1') <> '#6366f1';
  else
    v_changed := new.logo_url is distinct from old.logo_url or new.primary_color is distinct from old.primary_color;
  end if;

  if v_changed and not plan_has_feature(org_plan(new.organization_id), 'branding') then
    raise exception 'Custom branding is included with the Mission and Enterprise plans. Upgrade in Settings to use your logo and color.'
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end
$$;

drop trigger if exists zz_branding_plan on public.organization_settings;
create trigger zz_branding_plan before insert or update on public.organization_settings
  for each row execute function public.enforce_branding_plan();

-- Replaces the version from 006, adding custom_branding. On Starter, public
-- forms show the organization name but not its saved logo or color, and the
-- form page ignores each form's own colors and logo (forms.settings.theme)
-- when custom_branding is false. The return type changes, so drop it first.
drop function if exists public.get_public_form_branding(uuid);
create function public.get_public_form_branding(p_form_id uuid)
returns table (organization_name text, primary_color text, logo_url text, custom_branding boolean)
language sql stable security definer set search_path = public
as $$
  select o.name,
         case when b.allowed then s.primary_color end,
         case when b.allowed then s.logo_url end,
         b.allowed
  from forms f
  join organizations o on o.id = f.organization_id
  cross join lateral (select public.plan_has_feature(public.org_plan(o.id), 'branding') as allowed) b
  left join organization_settings s on s.organization_id = f.organization_id
  where f.id = p_form_id and f.is_published = true and coalesce(f.is_archived, false) = false
$$;

grant execute on function public.get_public_form_branding(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Usage for the Plan card
-- -----------------------------------------------------------------------------

-- The caller's plan and how much of each limit is used.
-- limits.* is null for unlimited.
create or replace function public.get_plan_usage()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_org  uuid := current_org_id();
  v_plan text;
begin
  if v_org is null then return null; end if;
  v_plan := org_plan(v_org);
  return jsonb_build_object(
    'plan', v_plan,
    'usage', jsonb_build_object(
      'forms',   plan_usage(v_org, 'forms'),
      'members', plan_usage(v_org, 'members'),
      'people',  plan_usage(v_org, 'people'),
      'reports', plan_usage(v_org, 'reports')),
    'limits', jsonb_build_object(
      'forms',   plan_limit(v_plan, 'forms'),
      'members', plan_limit(v_plan, 'members'),
      'people',  plan_limit(v_plan, 'people'),
      'reports', plan_limit(v_plan, 'reports'))
  );
end
$$;

revoke execute on function public.get_plan_usage() from public, anon;
grant execute on function public.get_plan_usage() to authenticated;

revoke execute on function public.org_plan(uuid)          from public, anon, authenticated;
revoke execute on function public.plan_usage(uuid, text)  from public, anon, authenticated;
revoke execute on function public.enforce_plan_limit()    from public, anon, authenticated;
revoke execute on function public.enforce_branding_plan() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Enterprise inquiries
--
-- No policies: only the enterprise-inquiry function (service role) writes
-- and reads them. View them in Table Editor > enterprise_inquiries.
-- -----------------------------------------------------------------------------

create table if not exists public.enterprise_inquiries (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null check (length(full_name) between 1 and 150),
  organization_name text not null check (length(organization_name) between 1 and 200),
  email             text not null check (length(email) between 3 and 320),
  work_email        text not null check (length(work_email) between 3 and 320),
  department        text not null check (length(department) between 1 and 150),
  organization_size text not null check (organization_size in ('1-10', '11-50', '51-200', '201-1000', '1000+')),
  work_goal         text not null check (length(work_goal) between 1 and 2000),
  enterprise_needs  text not null check (length(enterprise_needs) between 1 and 4000),
  -- The signed-in user who sent it, if any.
  user_id           uuid references auth.users(id) on delete set null,
  -- When the email to the team went out, or null if it didn't.
  notified_at       timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.enterprise_inquiries enable row level security;

commit;

-- =============================================================================
-- Moving an organization to Enterprise (after agreeing a price)
--
-- Bill them outside the app (invoice, or a custom Stripe price), then run:
--
--   update organization_billing set plan = 'enterprise', status = 'active'
--   where organization_id = (select organization_id from organization_members
--                            where email = 'owner@their-org.org');
--
-- To end it, set status = 'canceled'. Don't do this for an organization that
-- also has a Stripe subscription: the webhook would overwrite it.
-- =============================================================================
