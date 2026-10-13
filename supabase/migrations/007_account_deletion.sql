-- =============================================================================
-- ACCOUNT DELETION
--
-- Run after 006_branding_and_demo_data.sql.
--
-- What this does:
--   1. Keeps a team's records when one member deletes their account. The
--      original tables deleted every row a person created along with their
--      account (ON DELETE CASCADE on user_id), which would wipe out forms,
--      donations and so on that the rest of the team still uses. user_id now
--      becomes empty instead; the rows stay with the organization.
--   2. Adds account_deletion_requests: the one-time links emailed to people
--      who ask to delete their account (see the request-account-deletion and
--      confirm-account-deletion functions).
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. user_id: keep rows, clear the creator
--
-- Rewrites whichever foreign key each table has on user_id (to profiles or
-- auth.users), so this works whatever the live definitions are.
-- -----------------------------------------------------------------------------

do $$
declare
  t   text;
  fk  record;
begin
  -- TABLE LIST: tables whose rows belong to the organization, not the person.
  foreach t in array array['forms', 'donations', 'volunteer_hours', 'inventory_items', 'links',
                           'media_items', 'organization_settings', 'feedback']
  loop
    continue when to_regclass('public.' || t) is null;

    for fk in
      select con.conname, con.confrelid::regclass as ref
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
      where con.conrelid = ('public.' || t)::regclass
        and con.contype = 'f'
        and a.attname = 'user_id'
    loop
      execute format('alter table public.%I drop constraint %I', t, fk.conname);
      execute format(
        'alter table public.%I add constraint %I foreign key (user_id) references %s(id) on delete set null',
        t, fk.conname, fk.ref
      );
    end loop;

    execute format('alter table public.%I alter column user_id drop not null', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Deletion requests
--
-- Only a hash of the emailed token is stored, so a database leak can't be
-- used to delete accounts. No policies: only the Edge Functions (service
-- role) read or write this table.
-- -----------------------------------------------------------------------------

create table if not exists public.account_deletion_requests (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours')
);

alter table public.account_deletion_requests enable row level security;

commit;
