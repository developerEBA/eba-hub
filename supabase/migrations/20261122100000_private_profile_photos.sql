begin;

-- Private employee profile photos are only read or written by authenticated
-- server handlers after checking the current active membership. No public
-- bucket or public object policies are created.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('hub-profile-photos','hub-profile-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

grant select,insert,update on public.connect_profiles to service_role;

commit;
