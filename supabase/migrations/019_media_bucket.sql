-- =============================================================================
-- MEDIA STORAGE BUCKET
--
-- Run after 018_join_with_existing_organization.sql. Safe to run on a project
-- that already has the bucket.
--
-- The Media library and form logos upload to a storage bucket called
-- "media", but no earlier migration created it; it was expected to be made
-- by hand in the dashboard. Projects without it got "Bucket not found".
--
-- What this does:
--   1. Creates the public "media" bucket (files are shown with public links),
--      with the same size and type limits 014 set: images and audio, up to
--      25 MB. SVG isn't allowed, because an SVG file can carry scripts.
--   2. Lets owners, admins and members upload into their own folder
--      (<user id>/...), which is where the app puts every upload. Viewers and
--      read-only organizations can't upload.
--   3. Deleting teammates' files is already allowed by 003.
--
-- Run the whole file at once in the Supabase SQL Editor. If anything fails,
-- nothing is changed.
-- =============================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', true, 25 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/bmp', 'audio/*']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Editors can upload to their own media folder" on storage.objects;
create policy "Editors can upload to their own media folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_edit_org_data()
  );

commit;
