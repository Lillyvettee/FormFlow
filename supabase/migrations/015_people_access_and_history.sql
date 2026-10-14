-- =============================================================================
-- WHO CAN SEE PEOPLE, AND A CHANGE HISTORY
--
-- Run after 014_private_form_uploads.sql.
--
-- What this does:
--   1. Adds organizations.people_access, set by owners and admins on the
--      People page:
--        everyone  every member, including viewers
--        editors   owners, admins and members, not viewers (the default)
--        admins    owners and admins only
--      It covers people, help given (services), case notes, and form
--      responses sent through someone's personal link. The database enforces
--      it, so it can't be worked around from the browser. Totals and outcome
--      summaries (Reports, funder portals) aren't affected, since they don't
--      show who anyone is.
--   2. Adds activity_log: who added, changed or deleted a person, a help-given
--      entry or a case note, and when. Owners and admins can read it; nobody
--      can edit or delete it. It records which fields changed, not their
--      contents, so notes and details don't end up copied into the log.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Who can see People
-- -----------------------------------------------------------------------------

alter table public.organizations add column if not exists people_access text not null default 'editors';
alter table public.organizations drop constraint if exists organizations_people_access_check;
alter table public.organizations add constraint organizations_people_access_check check (people_access in ('everyone', 'editors', 'admins'));

create or replace function public.can_view_people()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    case (select o.people_access from organizations o where o.id = public.current_org_id())
      when 'everyone' then public.current_org_role() is not null
      when 'admins'   then public.current_org_role() in ('owner', 'admin')
      else                 public.current_org_role() in ('owner', 'admin', 'member')
    end,
    false
  )
$$;

revoke execute on function public.can_view_people() from public, anon;
grant execute on function public.can_view_people() to authenticated;

-- People, help given and case notes: the same rules as before, plus can_view_people().
drop policy if exists "Members can view" on public.people;
create policy "Members can view" on public.people for select to authenticated
  using (organization_id = public.current_org_id() and public.can_view_people());
drop policy if exists "Editors can add" on public.people;
create policy "Editors can add" on public.people for insert to authenticated
  with check (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people());
drop policy if exists "Editors can change" on public.people;
create policy "Editors can change" on public.people for update to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people())
  with check (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people());
drop policy if exists "Editors can delete" on public.people;
create policy "Editors can delete" on public.people for delete to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people());

drop policy if exists "Members can view" on public.services;
create policy "Members can view" on public.services for select to authenticated
  using (organization_id = public.current_org_id() and public.can_view_people());
drop policy if exists "Editors can add" on public.services;
create policy "Editors can add" on public.services for insert to authenticated
  with check (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people());
drop policy if exists "Editors can change" on public.services;
create policy "Editors can change" on public.services for update to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people())
  with check (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people());
drop policy if exists "Editors can delete" on public.services;
create policy "Editors can delete" on public.services for delete to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people());

drop policy if exists "Members can view" on public.case_notes;
create policy "Members can view" on public.case_notes for select to authenticated
  using (organization_id = public.current_org_id() and public.can_view_people());
drop policy if exists "Editors can add" on public.case_notes;
create policy "Editors can add" on public.case_notes for insert to authenticated
  with check (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people());
drop policy if exists "Authors can edit" on public.case_notes;
create policy "Authors can edit" on public.case_notes for update to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people() and author_id = auth.uid())
  with check (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people());
drop policy if exists "Authors and admins can delete" on public.case_notes;
create policy "Authors and admins can delete" on public.case_notes for delete to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data() and public.can_view_people() and (author_id = auth.uid() or public.is_org_admin()));

-- Form responses: those sent through someone's personal link follow the same rule.
drop policy if exists "Members can view submissions" on public.form_submissions;
create policy "Members can view submissions" on public.form_submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.forms f
      where f.id = form_submissions.form_id and f.organization_id = public.current_org_id()
    )
    and (form_submissions.person_id is null or public.can_view_people())
  );

-- -----------------------------------------------------------------------------
-- 2. Change history
-- -----------------------------------------------------------------------------

create table if not exists public.activity_log (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid references auth.users(id) on delete set null,
  -- Kept so the history still says who, after that member leaves.
  actor_name      text,
  action          text not null check (action in ('created', 'changed', 'deleted')),
  record_type     text not null check (record_type in ('person', 'help given', 'case note')),
  record_id       uuid not null,
  -- The person the record is about (kept even if the person is deleted).
  person_id       uuid,
  -- A short label like "Food box, Oct 3, 2026"; never note text or contact details.
  summary         text,
  changed_fields  text[],
  created_at      timestamptz not null default now()
);

create index if not exists activity_log_person_idx on public.activity_log (organization_id, person_id, created_at desc);

alter table public.activity_log enable row level security;

-- Read-only, owners and admins only. Rows are only written by the trigger below.
drop policy if exists "Admins can view" on public.activity_log;
create policy "Admins can view" on public.activity_log for select to authenticated
  using (organization_id = public.current_org_id() and public.is_org_admin());

create or replace function public.log_activity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  rec       jsonb := to_jsonb(coalesce(new, old));
  before    jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  kind      text := case tg_table_name when 'people' then 'person' when 'services' then 'help given' else 'case note' end;
  changed   text[];
  label     text;
  who       text;
begin
  -- When a whole organization is deleted, its history goes with it.
  if not exists (select 1 from organizations where id = (rec ->> 'organization_id')::uuid) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into changed
    from jsonb_object_keys(rec) k
    where k not in ('updated_at', 'access_token') and rec -> k is distinct from before -> k;
    -- Nothing people would call a change (e.g. only a timestamp moved).
    if changed is null then
      return new;
    end if;
  end if;

  label := case tg_table_name
    when 'people'   then rec ->> 'full_name'
    when 'services' then concat_ws(', ', rec ->> 'service_type', to_char((rec ->> 'date')::date, 'Mon FMDD, YYYY'))
    else 'Case note'
  end;

  select coalesce(nullif(trim(m.display_name), ''), m.email) into who
  from organization_members m
  where m.user_id = auth.uid() and m.organization_id = (rec ->> 'organization_id')::uuid;

  insert into activity_log (organization_id, actor_id, actor_name, action, record_type, record_id, person_id, summary, changed_fields)
  values (
    (rec ->> 'organization_id')::uuid,
    auth.uid(),
    who,
    case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'changed' else 'deleted' end,
    kind,
    (rec ->> 'id')::uuid,
    case when tg_table_name = 'people' then (rec ->> 'id')::uuid else (rec ->> 'person_id')::uuid end,
    left(label, 200),
    changed
  );
  return coalesce(new, old);
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['people', 'services', 'case_notes']
  loop
    execute format('drop trigger if exists log_activity on public.%I', t);
    execute format('create trigger log_activity after insert or update or delete on public.%I for each row execute function public.log_activity()', t);
  end loop;
end $$;

commit;
