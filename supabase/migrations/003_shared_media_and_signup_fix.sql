-- =============================================================================
-- SHARED MEDIA AND SIGNUP FIX
--
-- Run after 002_team_accounts.sql.
--
-- What this does:
--   1. Fixes new signups. The signup trigger (handle_new_user in 001) inserts
--      an organization_settings row, but a brand-new user has no organization
--      yet, so the set_organization_id trigger from 002 raised an error and
--      the signup failed. That row is now skipped; the Settings page creates
--      it with an upsert the first time branding is saved.
--   2. Shares the media library with the whole organization, like forms,
--      donations and the other data tables. media_items was left out of 002,
--      so it still had per-user rules.
--   3. Lets editors delete media files that a teammate uploaded. Files are
--      stored under the uploader's user id folder, which the existing storage
--      rules tie to that one user.
--
-- Not changed: feedback. It is messages to the app's makers, not
-- organization data, so it keeps its per-user rules.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Signup fix
--
-- A BEFORE INSERT trigger that returns null skips the row without an error.
-- Only organization_settings is skipped; other tables still require an
-- organization.
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
    -- The signup trigger creates a settings row before the user has an organization.
    if tg_table_name = 'organization_settings' then
      return null;
    end if;
    raise exception 'You need to belong to an organization to save data.';
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. media_items belongs to an organization
-- -----------------------------------------------------------------------------

alter table public.media_items
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

create index if not exists media_items_organization_id_idx on public.media_items (organization_id);

-- Move existing media into the uploader's organization.
update public.media_items d
   set organization_id = m.organization_id
  from public.organization_members m
 where d.organization_id is null and m.user_id = d.user_id;

-- Fails (and rolls back) if a file's uploader is no longer in any organization.
-- Find those rows with:
--   select * from media_items where organization_id is null;
alter table public.media_items alter column organization_id set not null;

drop trigger if exists set_organization_id on public.media_items;
create trigger set_organization_id before insert on public.media_items
  for each row execute function public.set_organization_id();

-- Replace the old per-user rules with the same rules as the other data tables.
do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'media_items'
  loop
    execute format('drop policy %I on public.media_items', p.policyname);
  end loop;
end $$;

alter table public.media_items enable row level security;

create policy "Members can view" on public.media_items for select to authenticated
  using (organization_id = public.current_org_id());

create policy "Editors can add" on public.media_items for insert to authenticated
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

create policy "Editors can change" on public.media_items for update to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data())
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

create policy "Editors can delete" on public.media_items for delete to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data());

-- -----------------------------------------------------------------------------
-- 3. Storage: editors can delete teammates' media files
--
-- Added alongside the existing storage rules, which stay as they are.
-- The first folder of each path is the uploader's user id
-- (see handleUpload in client/src/pages/media.tsx).
-- -----------------------------------------------------------------------------

drop policy if exists "Editors can delete teammates' media files" on storage.objects;
create policy "Editors can delete teammates' media files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and public.can_edit_org_data()
    and exists (
      select 1 from public.organization_members m
      where m.user_id::text = (storage.foldername(name))[1]
        and m.organization_id = public.current_org_id()
    )
  );

commit;
