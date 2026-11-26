-- One combined read-only PASS/FAIL diagnostic. It remains runnable if release objects are absent.
begin transaction read only;
with expected(name) as (values ('public.announcements'),('public.announcement_revisions'),
 ('public.announcement_acknowledgements'),('public.announcement_audit'))
select name as check_name,case when to_regclass(name) is null then 'FAIL: missing; apply announcements migration'
 when not (select relrowsecurity from pg_class where oid=to_regclass(name)) then 'FAIL: RLS disabled'
 else 'PASS' end as result from expected order by name;

with expected(signature) as (values
 ('public.announcement_manage(text,uuid,integer,jsonb,uuid)'),('public.announcement_next()'),
 ('public.announcement_history()'),('public.announcement_acknowledge(uuid,integer)'),
 ('eba_private.announcement_active()'),('eba_private.announcement_recipient_access(uuid,integer)'))
select signature,case when to_regprocedure(signature) is null then 'FAIL: function missing'
 when not has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE') then 'FAIL: authenticated execute missing'
 when signature like 'public.%' and has_function_privilege('anon',to_regprocedure(signature),'EXECUTE') then 'FAIL: anonymous execute is enabled'
 else 'PASS' end as result from expected order by signature;

with expected(name,table_name,schema_name) as (values
 ('Announcement managers read permitted records','announcements','public'),
 ('Announcement managers read permitted revisions','announcement_revisions','public'),
 ('Users read own announcement acknowledgements','announcement_acknowledgements','public'),
 ('Announcement managers read permitted audit','announcement_audit','public'))
select name,case when exists(select 1 from pg_policies p where p.policyname=name and p.tablename=table_name and p.schemaname=schema_name)
 then 'PASS' else 'FAIL: policy missing' end as result from expected order by name;

select 'Active management-only rollout and department recheck' as check_name,
 case when to_regprocedure('eba_private.announcement_active()') is null then 'FAIL: active gate missing'
 when to_regprocedure('eba_private.announcement_recipient_access(uuid,integer)') is null then 'FAIL: recipient gate missing'
 when pg_get_functiondef(to_regprocedure('eba_private.announcement_active()')) like '%ceo%'
 and pg_get_functiondef(to_regprocedure('eba_private.announcement_active()')) like '%admin%'
 and pg_get_functiondef(to_regprocedure('eba_private.announcement_recipient_access(uuid,integer)')) like '%staff_department_assignments%'
 then 'PASS' else 'FAIL: inspect role or assignment gate' end as result;

select 'No broad realtime announcement publication' as check_name,
 case when to_regclass('pg_publication_tables') is null then 'FAIL: publication catalog unavailable'
 when exists(select 1 from pg_publication_tables where schemaname='public' and tablename in
  ('announcements','announcement_revisions','announcement_acknowledgements','announcement_audit'))
 then 'FAIL: remove announcement tables from broad Realtime publication'
 else 'PASS' end as result;
rollback;
