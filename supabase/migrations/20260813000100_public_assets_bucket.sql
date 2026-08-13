-- Public storage bucket for the receipt logo (and future menu photos).
-- The printer bridge (APK) and the browser both fetch the image with no auth,
-- so reads are public; only logged-in staff can upload/replace/remove.

insert into storage.buckets (id, name, public)
values ('public-assets', 'public-assets', true)
on conflict (id) do nothing;

drop policy if exists "public-assets read" on storage.objects;
create policy "public-assets read"
  on storage.objects for select
  using (bucket_id = 'public-assets');

drop policy if exists "public-assets insert" on storage.objects;
create policy "public-assets insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets');

drop policy if exists "public-assets update" on storage.objects;
create policy "public-assets update"
  on storage.objects for update to authenticated
  using (bucket_id = 'public-assets');

drop policy if exists "public-assets delete" on storage.objects;
create policy "public-assets delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets');
