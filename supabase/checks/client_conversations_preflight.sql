select
  to_regclass('public.client_directory') as directory_table,
  to_regclass('public.client_portal_access') as portal_access_table,
  to_regprocedure('eba_private.client_portal_has_access(uuid)') as portal_access_check,
  to_regprocedure('eba_private.manage_client_portal(uuid,text,jsonb)') as portal_management,
  to_regprocedure('eba_private.accept_client_portal_invite(text)') as invite_acceptance,
  to_regclass('public.client_conversation_messages') as conversation_table,
  to_regprocedure('public.delete_client_record(uuid)') as delete_rpc;

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'client_directory'
  and column_name in ('deleted_at', 'deleted_by');
