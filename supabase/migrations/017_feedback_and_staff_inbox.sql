-- =============================================================================
-- FEEDBACK TABLE AND STAFF INBOX
--
-- Run after 016_plans_and_limits.sql.
--
-- What this does:
--   1. Creates the feedback table the Feedback page writes to. No earlier
--      migration created it, so a fresh project had no table. If yours was
--      made by hand in the dashboard, it is kept and only missing columns are
--      added.
--   2. Adds staff_admins: the HumMotion staff who can open the in-app inbox
--      (/admin). Starts with info@hummotion.com.
--   3. Adds is_staff(). True only for a signed-in user whose email is on the
--      list AND has been confirmed, so nobody can sign up with a staff
--      address they don't own and get in.
--   4. Lets staff read feedback and Enterprise inquiries, and mark them done
--      with set_inbox_resolved(). Customers still can't read any of it.
--
-- Adding or removing staff (SQL Editor):
--   insert into staff_admins (email) values ('someone@hummotion.com');
--   delete from staff_admins where email = 'someone@hummotion.com';
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Feedback
-- -----------------------------------------------------------------------------

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  email      text not null check (length(email) between 3 and 320),
  type       text not null default 'feedback' check (type in ('bug', 'feedback', 'feature', 'other')),
  subject    text not null check (length(subject) between 1 and 150),
  message    text not null check (length(message) between 1 and 5000),
  created_at timestamptz not null default now()
);

-- For a table made by hand: make sure every column the app uses exists.
alter table public.feedback add column if not exists user_id     uuid;
alter table public.feedback add column if not exists email       text;
alter table public.feedback add column if not exists type        text;
alter table public.feedback add column if not exists subject     text;
alter table public.feedback add column if not exists message     text;
alter table public.feedback add column if not exists created_at  timestamptz not null default now();
-- When staff marked it handled in the inbox.
alter table public.feedback add column if not exists resolved_at timestamptz;

alter table public.feedback enable row level security;

-- Anyone can send feedback, signed in or not, but only as themselves.
drop policy if exists "Anyone can send feedback" on public.feedback;
create policy "Anyone can send feedback" on public.feedback
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 2. Staff list
--
-- No policies: read only through is_staff(). Change it in the SQL Editor.
-- -----------------------------------------------------------------------------

create table if not exists public.staff_admins (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

alter table public.staff_admins enable row level security;

insert into public.staff_admins (email) values ('info@hummotion.com')
on conflict (email) do nothing;

-- -----------------------------------------------------------------------------
-- 3. is_staff()
-- -----------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join staff_admins s on s.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false
  )
$$;

revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Staff can read the inbox and mark items handled
-- -----------------------------------------------------------------------------

drop policy if exists "Staff can read feedback" on public.feedback;
create policy "Staff can read feedback" on public.feedback
  for select to authenticated
  using (public.is_staff());

alter table public.enterprise_inquiries add column if not exists resolved_at timestamptz;

drop policy if exists "Staff can read enterprise inquiries" on public.enterprise_inquiries;
create policy "Staff can read enterprise inquiries" on public.enterprise_inquiries
  for select to authenticated
  using (public.is_staff());

-- Marks one feedback message or Enterprise inquiry handled (or not).
-- p_kind: 'feedback' or 'enterprise'. Ids are passed as text because a
-- hand-made feedback table may not use uuid ids.
create or replace function public.set_inbox_resolved(p_kind text, p_id text, p_resolved boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'Only HumMotion staff can do this.';
  end if;
  if p_kind = 'feedback' then
    update feedback set resolved_at = case when p_resolved then now() end where id::text = p_id;
  elsif p_kind = 'enterprise' then
    update enterprise_inquiries set resolved_at = case when p_resolved then now() end where id::text = p_id;
  else
    raise exception 'Unknown inbox: %', p_kind;
  end if;
  if not found then
    raise exception 'That message no longer exists.';
  end if;
end
$$;

revoke execute on function public.set_inbox_resolved(text, text, boolean) from public, anon;
grant execute on function public.set_inbox_resolved(text, text, boolean) to authenticated;

commit;
