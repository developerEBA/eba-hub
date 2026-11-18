-- READ ONLY. No account, audience, invitation or credential changes.
begin transaction read only;
select role,status,count(*) from public.staff_memberships group by role,status;
select policyname,cmd,qual from pg_policies where schemaname='public' and tablename='calendar_occurrences';
select pg_get_functiondef('public.calendar_access()'::regprocedure);
select has_column_privilege('authenticated','public.calendar_occurrences','title','SELECT') meeting_read,
 has_column_privilege('authenticated','public.calendar_occurrences','provider_event_id','SELECT') provider_id_read_must_be_false,
 has_table_privilege('authenticated','public.calendar_occurrences','UPDATE') browser_update_must_be_false,
 has_table_privilege('authenticated','public.calendar_occurrences','INSERT') browser_insert_must_be_false,
 has_table_privilege('authenticated','public.calendar_occurrences','DELETE') browser_delete_must_be_false;
rollback;
