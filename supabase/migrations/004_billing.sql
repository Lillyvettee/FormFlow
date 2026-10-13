-- =============================================================================
-- BILLING: 30-DAY FREE TRIAL, SUBSCRIPTIONS AND DEMO DISCOUNT CODES
--
-- Run after 003_shared_media_and_signup_fix.sql.
--
-- What this does:
--   1. Adds organization_billing: one row per organization holding its trial
--      end date and Stripe subscription. Billing belongs to the organization,
--      not a person, because the whole team shares one subscription.
--      (The old per-user subscriptions table from 001 is no longer used.)
--   2. Starts a 30-day free trial for every new organization, and for every
--      existing organization starting now.
--   3. Makes organizations read-only once the trial ends without a
--      subscription: everyone can still sign in, view and export, but nothing
--      can be added, changed or deleted, and public forms stop accepting
--      responses. Subscribing restores everything immediately.
--   4. Adds demo_codes: each demo visitor gets their own one-time code for
--      half off for as long as they stay subscribed.
--
-- Rows in organization_billing are written only by the stripe-webhook
-- function (with the service role key). The app can read its own
-- organization's row but never change it.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Billing table
-- -----------------------------------------------------------------------------

create table if not exists public.organization_billing (
  organization_id        uuid primary key references public.organizations(id) on delete cascade,
  trial_ends_at          timestamptz not null default (now() + interval '30 days'),
  -- Stripe's subscription status ('active', 'trialing', 'past_due', 'canceled',
  -- 'unpaid', ...), or null if the organization has never subscribed.
  status                 text,
  plan                   text check (plan in ('starter', 'mission')),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  -- The demo code used when subscribing, if any.
  discount_code          text,
  updated_at             timestamptz not null default now()
);

drop trigger if exists organization_billing_updated_at on public.organization_billing;
create trigger organization_billing_updated_at before update on public.organization_billing
  for each row execute procedure public.handle_updated_at();

alter table public.organization_billing enable row level security;

drop policy if exists "Members can view billing" on public.organization_billing;
create policy "Members can view billing" on public.organization_billing
  for select to authenticated
  using (organization_id = public.current_org_id());

-- -----------------------------------------------------------------------------
-- 2. Every organization gets a 30-day trial
-- -----------------------------------------------------------------------------

create or replace function public.create_organization_billing()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into organization_billing (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end
$$;

drop trigger if exists create_organization_billing on public.organizations;
create trigger create_organization_billing after insert on public.organizations
  for each row execute function public.create_organization_billing();

-- Existing organizations: the 30 days start now.
insert into public.organization_billing (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Read-only after the trial
-- -----------------------------------------------------------------------------

-- True while an organization is in its free trial or has a working
-- subscription. 'past_due' still counts while Stripe retries the payment.
create or replace function public.org_has_access(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select b.status in ('active', 'trialing', 'past_due') or b.trial_ends_at > now()
    from organization_billing b
    where b.organization_id = p_org
  ), false)
$$;

-- Replaces the version from 002. Every data table's add, change and delete
-- rules call this, so this one change makes the whole app read-only.
create or replace function public.can_edit_org_data()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_org_role() in ('owner', 'admin', 'member'), false)
     and public.org_has_access(public.current_org_id())
$$;

-- Public forms: a clear message instead of a security error. Runs before the
-- security rules check the row.
create or replace function public.check_form_accepting_responses()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from forms f
    where f.id = new.form_id and public.org_has_access(f.organization_id)
  ) then
    raise exception 'This form isn''t accepting responses right now.';
  end if;
  return new;
end
$$;

drop trigger if exists check_form_accepting_responses on public.form_submissions;
create trigger check_form_accepting_responses before insert on public.form_submissions
  for each row execute function public.check_form_accepting_responses();

-- -----------------------------------------------------------------------------
-- 4. Demo discount codes
--
-- No policies: the app reads a code only through get_my_demo_code(), and the
-- Stripe functions use the service role key.
-- -----------------------------------------------------------------------------

create table if not exists public.demo_codes (
  code                     text primary key,
  -- The demo visitor it was issued to. Anonymous users can be cleaned up
  -- later, so this may become null; the code still works.
  user_id                  uuid unique references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  redeemed_at              timestamptz,
  redeemed_by_organization uuid references public.organizations(id) on delete set null,
  -- When the "someone locked in" email went out. Lets the webhook retry a
  -- failed email without sending it twice.
  notified_at              timestamptz
);

alter table public.demo_codes enable row level security;

-- Returns the signed-in demo visitor's code, creating it the first time.
-- Only demo (anonymous) visitors get a code.
create or replace function public.get_my_demo_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false then
    raise exception 'Discount codes are only for demo visitors.';
  end if;

  select code into v_code from demo_codes where user_id = auth.uid();
  if v_code is null then
    -- 8 hex characters, e.g. DEMO-3F9A1C27. Hex has no O or I to mistake for 0 or 1.
    v_code := 'DEMO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into demo_codes (code, user_id) values (v_code, auth.uid());
  end if;
  return v_code;
end
$$;

revoke execute on function public.get_my_demo_code() from public, anon;
grant execute on function public.get_my_demo_code() to authenticated;

commit;
