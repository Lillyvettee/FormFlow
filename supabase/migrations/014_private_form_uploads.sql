-- =============================================================================
-- PRIVATE FORM UPLOADS AND STORAGE LIMITS
--
-- Run after 013_form_notifications.sql.
--
-- What this does:
--   1. Adds a private storage bucket, form-uploads, for photos and voice
--      memos sent through forms. Files are stored at <form id>/<random name>.
--        - Anyone can upload to a published form (that's how forms work),
--          but can't list, open or replace anything.
--        - Members of the form's organization can open files, through links
--          that expire (the app asks for one each time a file is shown).
--        - Editors can remove their organization's files. Respondents can't
--          remove anything: removing a file requires being able to see it,
--          and letting respondents see uploads would expose other people's.
--          (If saving a response fails after its upload, the file stays,
--          still private.)
--   2. Limits uploads on the server, not just in the browser: images (not
--      SVG, which can carry scripts) and audio, up to 25 MB, for both
--      form-uploads and the existing media bucket.
--
-- Files uploaded before this stay where they were (public links in the media
-- bucket) and keep working. New uploads are private.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Buckets and limits
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('form-uploads', 'form-uploads', false)
on conflict (id) do update set public = false;

update storage.buckets
set file_size_limit = 25 * 1024 * 1024,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/bmp',
      'audio/*'
    ]
where id in ('form-uploads', 'media');

-- -----------------------------------------------------------------------------
-- 2. Who can do what in form-uploads
-- -----------------------------------------------------------------------------

-- The form id from a path like "<form id>/<file>". Null for anything else.
create or replace function public.form_upload_form_id(object_name text)
returns uuid
language sql immutable
as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(object_name, '/', 1)::uuid end
$$;

drop policy if exists "Anyone can upload to a published form" on storage.objects;
create policy "Anyone can upload to a published form" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'form-uploads'
    and exists (
      select 1 from public.forms f
      where f.id = public.form_upload_form_id(name)
        and f.is_published = true
        and coalesce(f.is_archived, false) = false
        and public.org_has_access(f.organization_id)
    )
  );

drop policy if exists "Members can open their form uploads" on storage.objects;
create policy "Members can open their form uploads" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-uploads'
    and exists (
      select 1 from public.forms f
      where f.id = public.form_upload_form_id(name)
        and f.organization_id = public.current_org_id()
    )
  );

drop policy if exists "Recent uploads can be removed, editors can remove theirs" on storage.objects;
drop policy if exists "Editors can remove their form uploads" on storage.objects;
create policy "Editors can remove their form uploads" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'form-uploads'
    and exists (
      select 1 from public.forms f
      where f.id = public.form_upload_form_id(name)
        and f.organization_id = public.current_org_id()
        and public.can_edit_org_data()
    )
  );

commit;
