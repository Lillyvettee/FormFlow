-- =============================================================================
-- RESTORE ACCESS RULES FOR FORMS AND FORM RESPONSES
--
-- Run after 020_funder_portal_options.sql. Safe to run more than once.
--
-- A live project was found with row-level security on forms and
-- form_submissions but no rules at all, which blocks everything: visitors
-- got "Form not found", and teams couldn't see their forms or responses.
-- This puts back the rules from 002 (as later changed by 015), exactly:
--
--   forms
--     Members can view / Editors can add, change, delete   own organization
--     Anyone can view published forms                       public form page
--   form_submissions
--     Anyone can submit to a published form                 public form page
--     Members can view submissions                          not personal-link
--                                                           responses unless
--                                                           they can see People
--     Editors can delete submissions
--
-- Read-only organizations (trial ended) still can't add, change or delete:
-- can_edit_org_data() checks that, and check_form_accepting_responses (004)
-- still refuses new responses for them.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- forms
-- -----------------------------------------------------------------------------

alter table public.forms enable row level security;

drop policy if exists "Members can view" on public.forms;
create policy "Members can view" on public.forms for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists "Editors can add" on public.forms;
create policy "Editors can add" on public.forms for insert to authenticated
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Editors can change" on public.forms;
create policy "Editors can change" on public.forms for update to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data())
  with check (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Editors can delete" on public.forms;
create policy "Editors can delete" on public.forms for delete to authenticated
  using (organization_id = public.current_org_id() and public.can_edit_org_data());

drop policy if exists "Anyone can view published forms" on public.forms;
create policy "Anyone can view published forms" on public.forms
  for select to anon, authenticated
  using (is_published = true and coalesce(is_archived, false) = false);

-- -----------------------------------------------------------------------------
-- form_submissions
-- -----------------------------------------------------------------------------

alter table public.form_submissions enable row level security;

drop policy if exists "Anyone can submit to a published form" on public.form_submissions;
create policy "Anyone can submit to a published form" on public.form_submissions
  for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.forms f
      where f.id = form_id and f.is_published = true and coalesce(f.is_archived, false) = false
    )
  );

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

drop policy if exists "Editors can delete submissions" on public.form_submissions;
create policy "Editors can delete submissions" on public.form_submissions
  for delete to authenticated
  using (
    public.can_edit_org_data()
    and exists (
      select 1 from public.forms f
      where f.id = form_submissions.form_id and f.organization_id = public.current_org_id()
    )
  );

commit;

-- =============================================================================
-- Check: tables that block everything (security on, no rules). After this
-- file, the list should not include forms or form_submissions. Tables meant
-- to be read only through functions (e.g. report_usage, staff_admins,
-- enterprise_inquiries for non-staff, funder_share_secrets, demo_codes) are
-- expected here.
--
--   select c.relname as table_name
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
--     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
--   order by 1;
-- =============================================================================
