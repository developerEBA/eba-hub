select conrelid::regclass as dependent_table, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'f' and confrelid = 'public.client_directory'::regclass
order by 1;

select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') || coalesce(with_check, '')) like '%client-shared-files%';

select to_regprocedure('public.delete_client_record(uuid)') as existing_delete_rpc,
  to_regclass('public.client_conversation_messages') as conversation_table,
  to_regclass('eba_private.client_deletion_audit') as new_audit_table,
  to_regclass('public.client_file_cleanup') as new_cleanup_queue;

select count(*) filter (where split_part(s.object_path, '/', 1) = s.client_id::text
    and o.id is not null) as owned_file_candidates,
  count(*) filter (where split_part(s.object_path, '/', 1) <> s.client_id::text) as mismatched_file_paths,
  count(*) filter (where o.id is null) as missing_storage_objects
from public.client_portal_shares s
left join storage.objects o on o.bucket_id = 'client-shared-files' and o.name = s.object_path
where s.kind = 'file';
