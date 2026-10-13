-- =============================================================================
-- TEAM ACCOUNTS MIGRATION
--
-- What this does:
--   1. Adds organizations, organization members (with roles) and invitations.
--   2. Gives every existing user their own organization (as owner) and moves
--      their existing data into it, so nothing changes for current users.
--   3. Adds organization_id to every data table and fills it in automatically
--      on new rows.
--   4. REPLACES the security rules (row-level security) on the data tables so
--      that everyone in an organization shares its data, based on role.
--   5. Adds database functions for creating organizations, inviting people,
--      accepting invitations and managing members.
--
-- Roles:
--   owner   full control, including managing other owners
--   admin   manage team, settings and all data
--   member  add, edit and delete data
--   viewer  read-only (good for board members and auditors)
--
-- Rule: each user belongs to exactly one organization.
--
-- BEFORE RUNNING:
--   - Back up your database (Supabase dashboard > Database > Backups), or run
--     this on a copy of your project first.
--   - Step 5 DELETES all existing security policies on the data tables listed
--     in data_tables below and replaces them. Storage (file upload) policies
--     are not touched.
--   - If any of your table names differ, edit the arrays marked
--     "TABLE LIST" before running.
--   - Every existing row must have a user_id, or step 4 will fail and the whole
--     migration will be rolled back (nothing is changed).
--
-- Run the whole file at once in the Supabase SQL Editor.
--
-- Already applied to the live project. Kept here so the repo
-- matches the database; do not run it again there.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. New tables
-- -----------------------------------------------------------------------------

-- An organization (nonprofit). All shared data belongs to one of these.
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 150),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Who belongs to which organization, and their role.
-- email and display_name are copied here at join time because the app cannot
-- read auth.users directly (it is private to Supabase).
create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  email           text,
  display_name    text,
  joined_at       timestamptz not null default now(),
  primary key (organization_id, user_id),
  -- One organization per user.
  constraint organization_members_one_org_per_user unique (user_id)
);

-- Pending invitations. The token is the secret part of the invite link.
create table if not exists public.organization_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role            text not null check (role in ('admin', 'member', 'viewer')),
  token           uuid not null unique default gen_random_uuid(),
  invited_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '14 days'),
  accepted_at     timestamptz
);

-- At most one open invitation per email per organization.
create unique index if not exists organization_invitations_one_pending_per_email
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null;

-- -----------------------------------------------------------------------------
-- 2. Helper functions used by the security rules
--
-- These are SECURITY DEFINER so they can read organization_members without
-- being blocked by that table's own security rules (which would otherwise
-- cause an infinite loop). search_path is pinned to prevent hijacking.
-- -----------------------------------------------------------------------------

-- The signed-in user's organization id, or null.
create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select organization_id from public.organization_members where user_id = auth.uid()
$$;

-- The signed-in user's role, or null.
create or replace function public.current_org_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.organization_members where user_id = auth.uid()
$$;

-- True for roles that can change data (everyone except viewers).
create or replace function public.can_edit_org_data()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_org_role() in ('owner', 'admin', 'member'), false)
$$;

-- True for owners and admins.
create or replace function public.is_org_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_org_role() in ('owner', 'admin'), false)
$$;

-- -----------------------------------------------------------------------------
-- 3. Add organization_id to every data table
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  -- TABLE LIST: every table that holds organization data.
  foreach t in array array['forms', 'donations', 'volunteer_hours', 'inventory_items', 'links', 'organization_settings']
  loop
    execute format(
      'alter table public.%I add column if not exists organization_id uuid references public.organizations(id) on delete cascade',
      t
    );
    execute format('create index if not exists %I on public.%I (organization_id)', t || '_organization_id_idx', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Backfill: one organization per existing user, and move their data into it
-- -----------------------------------------------------------------------------

do $$
declare
  u        record;
  new_org  uuid;
  org_name text;
begin
  for u in
    select id, email, raw_user_meta_data as meta
    from auth.users
    where id not in (select user_id from public.organization_members)
  loop
    -- Best available name: branding settings, then sign-up form, then the person's name.
    org_name := coalesce(
      nullif(trim((select s.organization_name from public.organization_settings s where s.user_id = u.id limit 1)), ''),
      nullif(trim(u.meta ->> 'organization_name'), ''),
      nullif(trim(u.meta ->> 'full_name'), '') || '''s organization',
      'My organization'
    );

    insert into public.organizations (name, created_by)
    values (left(org_name, 150), u.id)
    returning id into new_org;

    insert into public.organization_members (organization_id, user_id, role, email, display_name)
    values (new_org, u.id, 'owner', u.email, u.meta ->> 'full_name');
  end loop;
end $$;

do $$
declare
  t text;
begin
  -- TABLE LIST: same tables as step 3.
  foreach t in array array['forms', 'donations', 'volunteer_hours', 'inventory_items', 'links', 'organization_settings']
  loop
    execute format(
      'update public.%I d set organization_id = m.organization_id
         from public.organization_members m
        where d.organization_id is null and m.user_id = d.user_id',
      t
    );
    -- Every row must now belong to an organization.
    execute format('alter table public.%I alter column organization_id set not null', t);
  end loop;
end $$;

-- Branding is now one row per organization (not per user).
create unique index if not exists organization_settings_one_per_org
  on public.organization_settings (organization_id);

-- -----------------------------------------------------------------------------
-- Fill in organization_id automatically on new rows.
--
-- This is what lets the existing pages keep working: they do not need to send
-- organization_id; the database adds the signed-in user's organization.
-- The security rules below still reject any row whose organization_id is not
-- the user's own, so a tampered request cannot write into another organization.
-- -----------------------------------------------------------------------------

create or replace function public.set_organization_id()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.organization_id is null then
    new.organization_id := public.current_org_id();
  end if;
  if new.organization_id is null then
    raise exception 'You need to belong to an organization to save data.';
  end if;
  return new;
end
$$;

do $$
declare
  t text;
begin
  -- TABLE LIST: same tables as step 3.
  foreach t in array array['forms', 'donations', 'volunteer_hours', 'inventory_items', 'links', 'organization_settings']
  loop
    execute format('drop trigger if exists set_organization_id on public.%I', t);
    execute format(
      'create trigger set_organization_id before insert on public.%I
         for each row execute function public.set_organization_id()',
      t
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Security rules (row-level security) for data tables
--
-- All existing policies on these tables are dropped first, because old
-- "user_id = auth.uid()" rules would block teammates from each other's data.
-- -----------------------------------------------------------------------------

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      -- TABLE LIST: data tables plus form_submissions.
      and tablename in ('forms', 'donations', 'volunteer_hours', 'inventory_items', 'links',
                        'organization_settings', 'form_submissions')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Standard tables: members read; owners, admins and members write; viewers read only.
do $$
declare
  t text;
begin
  -- TABLE LIST: standard data tables (forms and settings have their own rules below).
  foreach t in array array['forms', 'donations', 'volunteer_hours', 'inventory_items', 'links']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy "Members can view" on public.%I for select to authenticated
         using (organization_id = public.current_org_id())', t);

    execute format(
      'create policy "Editors can add" on public.%I for insert to authenticated
         with check (organization_id = public.current_org_id() and public.can_edit_org_data())', t);

    -- WITH CHECK also stops a row from being moved into another organization.
    execute format(
      'create policy "Editors can change" on public.%I for update to authenticated
         using (organization_id = public.current_org_id() and public.can_edit_org_data())
         with check (organization_id = public.current_org_id() and public.can_edit_org_data())', t);

    execute format(
      'create policy "Editors can delete" on public.%I for delete to authenticated
         using (organization_id = public.current_org_id() and public.can_edit_org_data())', t);
  end loop;
end $$;

-- Forms: anyone (including signed-out respondents) can load a published,
-- non-archived form. This powers the public /forms/:id/submit page.
create policy "Anyone can view published forms" on public.forms
  for select to anon, authenticated
  using (is_published = true and coalesce(is_archived, false) = false);

-- Branding: everyone in the organization can read it; only owners and admins change it.
alter table public.organization_settings enable row level security;

create policy "Members can view settings" on public.organization_settings
  for select to authenticated
  using (organization_id = public.current_org_id());

create policy "Admins can add settings" on public.organization_settings
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_org_admin());

create policy "Admins can change settings" on public.organization_settings
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_org_admin())
  with check (organization_id = public.current_org_id() and public.is_org_admin());

-- Form submissions: anyone can submit to a published form, but only members
-- of the form's organization can read them. Respondents cannot read anyone's
-- answers, including their own.
alter table public.form_submissions enable row level security;

create policy "Anyone can submit to a published form" on public.form_submissions
  for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.forms f
      where f.id = form_id and f.is_published = true and coalesce(f.is_archived, false) = false
    )
  );

create policy "Members can view submissions" on public.form_submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.forms f
      where f.id = form_submissions.form_id and f.organization_id = public.current_org_id()
    )
  );

create policy "Editors can delete submissions" on public.form_submissions
  for delete to authenticated
  using (
    public.can_edit_org_data()
    and exists (
      select 1 from public.forms f
      where f.id = form_submissions.form_id and f.organization_id = public.current_org_id()
    )
  );

-- -----------------------------------------------------------------------------
-- 6. Security rules for the team tables
--
-- Members and invitations can only be changed through the functions in
-- step 7, which enforce the role rules. There are deliberately no direct
-- insert/update/delete policies on organization_members.
-- -----------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;

drop policy if exists "Members can view their organization" on public.organizations;
create policy "Members can view their organization" on public.organizations
  for select to authenticated
  using (id = public.current_org_id());

drop policy if exists "Admins can rename their organization" on public.organizations;
create policy "Admins can rename their organization" on public.organizations
  for update to authenticated
  using (id = public.current_org_id() and public.is_org_admin())
  with check (id = public.current_org_id() and public.is_org_admin());

drop policy if exists "Members can view their team" on public.organization_members;
create policy "Members can view their team" on public.organization_members
  for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists "Admins can view invitations" on public.organization_invitations;
create policy "Admins can view invitations" on public.organization_invitations
  for select to authenticated
  using (organization_id = public.current_org_id() and public.is_org_admin());

drop policy if exists "Admins can revoke invitations" on public.organization_invitations;
create policy "Admins can revoke invitations" on public.organization_invitations
  for delete to authenticated
  using (organization_id = public.current_org_id() and public.is_org_admin());

-- -----------------------------------------------------------------------------
-- 7. Team functions (called from the app with supabase.rpc)
--
-- Error messages raised here are shown to users as-is, so they are written
-- in plain language.
-- -----------------------------------------------------------------------------

-- Create an organization for a signed-in user who does not have one yet.
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_org  uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;
  if v_name = '' then
    raise exception 'Enter a name for your organization.';
  end if;
  if exists (select 1 from organization_members where user_id = auth.uid()) then
    raise exception 'You already belong to an organization.';
  end if;

  insert into organizations (name, created_by) values (left(v_name, 150), auth.uid())
  returning id into v_org;

  insert into organization_members (organization_id, user_id, role, email, display_name)
  values (v_org, auth.uid(), 'owner', auth.email(), auth.jwt() -> 'user_metadata' ->> 'full_name');

  return v_org;
end
$$;

-- Create an invitation and return its token (used to build the invite link).
create or replace function public.create_invitation(p_email text, p_role text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_org   uuid := current_org_id();
  v_token uuid;
begin
  if not is_org_admin() then
    raise exception 'Only owners and admins can invite people.';
  end if;
  if p_role not in ('admin', 'member', 'viewer') then
    raise exception 'Choose admin, member or viewer.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if exists (select 1 from organization_members where organization_id = v_org and lower(email) = v_email) then
    raise exception 'That person is already on your team.';
  end if;

  -- Replace any earlier open invitation for the same email.
  delete from organization_invitations
   where organization_id = v_org and lower(email) = v_email and accepted_at is null;

  insert into organization_invitations (organization_id, email, role, invited_by)
  values (v_org, v_email, p_role, auth.uid())
  returning token into v_token;

  return v_token;
end
$$;

-- Look up an invitation by token, so the invite page can show who it is from
-- before the person signs in. Returns nothing for an unknown token.
create or replace function public.get_invitation(p_token uuid)
returns table (organization_name text, email text, role text, status text)
language sql stable security definer set search_path = public
as $$
  select o.name,
         i.email,
         i.role,
         case
           when i.accepted_at is not null then 'accepted'
           when i.expires_at < now()      then 'expired'
           else 'valid'
         end
  from organization_invitations i
  join organizations o on o.id = i.organization_id
  where i.token = p_token
$$;

-- Accept an invitation as the signed-in user.
-- The signed-in email must match the invited email, so a forwarded or leaked
-- link cannot be used by someone else.
create or replace function public.accept_invitation(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  inv organization_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to accept this invitation.';
  end if;

  select * into inv from organization_invitations where token = p_token for update;
  if not found then
    raise exception 'This invitation link is not valid. Ask for a new one.';
  end if;

  -- Already a member of this organization: treat as success.
  if exists (select 1 from organization_members where user_id = auth.uid() and organization_id = inv.organization_id) then
    update organization_invitations set accepted_at = coalesce(accepted_at, now()) where id = inv.id;
    return inv.organization_id;
  end if;

  if inv.accepted_at is not null then
    raise exception 'This invitation has already been used.';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.';
  end if;
  if lower(inv.email) <> lower(coalesce(auth.email(), '')) then
    raise exception 'This invitation was sent to %. Sign in with that email address to accept it.', inv.email;
  end if;
  if exists (select 1 from organization_members where user_id = auth.uid()) then
    raise exception 'You already belong to another organization. Leave it first to join this one.';
  end if;

  insert into organization_members (organization_id, user_id, role, email, display_name)
  values (inv.organization_id, auth.uid(), inv.role, auth.email(), auth.jwt() -> 'user_metadata' ->> 'full_name');

  update organization_invitations set accepted_at = now() where id = inv.id;
  return inv.organization_id;
end
$$;

-- Change a teammate's role.
--   Admins can change members and viewers, and make people admins.
--   Only owners can make someone an owner or change an owner's role.
--   The last owner cannot be demoted.
create or replace function public.update_member_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org         uuid := current_org_id();
  v_caller_role text := current_org_role();
  v_target_role text;
begin
  if v_caller_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can change roles.';
  end if;
  if p_role not in ('owner', 'admin', 'member', 'viewer') then
    raise exception 'That is not a valid role.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role. Ask another owner or admin.';
  end if;

  select role into v_target_role from organization_members
   where organization_id = v_org and user_id = p_user_id for update;
  if not found then
    raise exception 'That person is not on your team.';
  end if;

  if (p_role = 'owner' or v_target_role = 'owner') and v_caller_role <> 'owner' then
    raise exception 'Only owners can add or change owners.';
  end if;
  if v_target_role = 'owner' and p_role <> 'owner'
     and (select count(*) from organization_members where organization_id = v_org and role = 'owner') <= 1 then
    raise exception 'Your organization needs at least one owner.';
  end if;

  update organization_members set role = p_role where organization_id = v_org and user_id = p_user_id;
end
$$;

-- Remove a teammate. Their past records stay with the organization.
create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org         uuid := current_org_id();
  v_caller_role text := current_org_role();
  v_target_role text;
begin
  if v_caller_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can remove people.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'To remove yourself, use "Leave organization".';
  end if;

  select role into v_target_role from organization_members
   where organization_id = v_org and user_id = p_user_id;
  if not found then
    raise exception 'That person is not on your team.';
  end if;
  if v_target_role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'Only owners can remove an owner.';
  end if;

  delete from organization_members where organization_id = v_org and user_id = p_user_id;
end
$$;

-- Leave your organization.
-- Blocked for the last owner (someone must be able to manage the account)
-- and for the only member (leaving would orphan all the data).
create or replace function public.leave_organization()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org  uuid := current_org_id();
  v_role text := current_org_role();
begin
  if v_org is null then
    raise exception 'You are not in an organization.';
  end if;
  if (select count(*) from organization_members where organization_id = v_org) <= 1 then
    raise exception 'You are the only member. Invite someone and make them an owner before leaving.';
  end if;
  if v_role = 'owner'
     and (select count(*) from organization_members where organization_id = v_org and role = 'owner') <= 1 then
    raise exception 'You are the only owner. Make someone else an owner before leaving.';
  end if;

  delete from organization_members where organization_id = v_org and user_id = auth.uid();
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Who can call which function
-- Postgres lets everyone call functions by default; tighten that.
-- -----------------------------------------------------------------------------

revoke execute on function public.create_organization(text)        from public, anon;
revoke execute on function public.create_invitation(text, text)    from public, anon;
revoke execute on function public.accept_invitation(uuid)          from public, anon;
revoke execute on function public.update_member_role(uuid, text)   from public, anon;
revoke execute on function public.remove_member(uuid)              from public, anon;
revoke execute on function public.leave_organization()             from public, anon;

grant execute on function public.create_organization(text)         to authenticated;
grant execute on function public.create_invitation(text, text)     to authenticated;
grant execute on function public.accept_invitation(uuid)           to authenticated;
grant execute on function public.update_member_role(uuid, text)    to authenticated;
grant execute on function public.remove_member(uuid)               to authenticated;
grant execute on function public.leave_organization()              to authenticated;

-- The invite page shows details before sign-in, so signed-out visitors can
-- look up an invitation (they still need the secret token).
grant execute on function public.get_invitation(uuid) to anon, authenticated;

-- Keeps your name on the Team page in sync when you change it in Settings
-- (called from saveProfile in client/src/pages/settings.tsx).
create or replace function public.update_my_display_name(p_name text)
returns void language sql security definer set search_path = public as $$
  update organization_members set display_name = nullif(left(trim(p_name), 100), '')
  where user_id = auth.uid();
$$;
revoke execute on function public.update_my_display_name(text) from public, anon;
grant execute on function public.update_my_display_name(text) to authenticated;

commit;
