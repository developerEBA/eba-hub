select to_regclass('public.client_conversation_messages') as messages,
  to_regclass('public.hub_notifications') as notifications,
  to_regclass('public.client_message_reads') as new_receipts,
  to_regprocedure('eba_private.client_directory_can_write()') as active_admin_check,
  to_regprocedure('eba_private.client_portal_has_access(uuid)') as portal_access_check;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.hub_notifications'::regclass and contype = 'c';

select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('client_conversation_messages', 'hub_notifications')
order by tablename, policyname;

select pubname, schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hub_notifications';
