-- Supabase-specific: separate from core PostgreSQL so core policy tests do not simulate Storage/Realtime.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('workspace-files','workspace-files',false,4194304,array['image/png','image/jpeg','image/webp','application/pdf','text/plain','audio/webm','audio/ogg','audio/mp4']) on conflict(id) do nothing;
create policy workspace_object_insert on storage.objects for insert to authenticated with check(bucket_id='workspace-files' and (storage.foldername(name))[1]=auth.uid()::text and public.is_employee());
create policy workspace_object_read on storage.objects for select to authenticated using(public.is_employee() and bucket_id='workspace-files' and ((storage.foldername(name))[1]=auth.uid()::text or exists(select 1 from public.workspace_files f where f.path=name and public.in_conversation(f.conversation_id))));
create policy workspace_object_delete on storage.objects for delete to authenticated using(public.is_employee() and bucket_id='workspace-files' and (storage.foldername(name))[1]=auth.uid()::text);
-- Only persisted messages are broadcast. Subscription access remains subject to SELECT RLS.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
 alter publication supabase_realtime add table public.messages;
 end if;
end $$;
-- Scheduler setup is an explicit operator step, not a browser timer:
-- select cron.schedule('eba-task-reminders','* * * * *','select public.deliver_due_reminders()');
-- Enable pg_cron in the approved Supabase project before executing that command.

-- Fail closed if an existing bucket has incompatible visibility or size limits.
do $$ begin
 if exists(select 1 from storage.buckets where id='workspace-files' and (public or file_size_limit is null or file_size_limit>4194304)) then raise exception 'workspace-files must be private with a maximum size of 4 MB';end if;
end $$;
