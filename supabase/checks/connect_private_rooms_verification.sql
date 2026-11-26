-- Combined read-only post-migration diagnostic for private department rooms.
-- Safe before rollout: absent tables, columns, policies or functions are named FAIL rows.
begin transaction read only;

with objects(feature,object_name) as (values
  ('Conversation types','public.connect_conversations'),
  ('Messages','public.connect_messages'),
  ('Legacy reader snapshot','public.connect_legacy_room_readers'),
  ('Department assignments','public.staff_department_assignments'),
  ('Staff directory names','public.staff_access_profiles'),
  ('Notifications','public.hub_notifications'),
  ('Read receipts','public.connect_message_reads'),
  ('Voice media','storage.objects'),
  ('Photo/document media','storage.objects')
), object_results as (
  select feature,object_name,to_regclass(object_name) as relation
  from objects
)
select feature,object_name,
  case when relation is null then 'FAIL: missing object/migration'
       when not (select relrowsecurity from pg_class where oid=relation) then 'FAIL: RLS disabled'
       else 'PASS: exists with RLS enabled' end as result
from object_results order by feature;

with columns(table_name,column_name) as (values
  ('connect_conversations','room_type'),('connect_conversations','department'),('connect_conversations','archived_at'),
  ('connect_messages','conversation_id'),('staff_department_assignments','department'),
  ('hub_notifications','conversation_id'),('connect_legacy_room_readers','room_id'),('connect_legacy_room_readers','user_id')
)
select table_name||'.'||column_name as check_name,
  case when to_regclass('public.'||table_name) is null then 'FAIL: table missing'
       when exists(select 1 from information_schema.columns c where c.table_schema='public'
         and c.table_name=columns.table_name and c.column_name=columns.column_name) then 'PASS'
       else 'FAIL: column missing' end as result
from columns order by table_name,column_name;

with functions(signature) as (values
  ('eba_private.connect_is_active(uuid)'),
  ('eba_private.connect_has_joined(uuid)'),
  ('eba_private.connect_user_can_read(uuid,uuid)'),
  ('eba_private.connect_can_read(uuid)'),
  ('eba_private.connect_can_write(uuid)'),
  ('public.connect_department_members(uuid)'),
  ('public.connect_open_dm(uuid)'),
  ('public.connect_read_chat(uuid,bigint)'),
  ('public.connect_change_message(bigint,text,text)'),
  ('public.connect_unread_counts()')
)
select signature,case when to_regprocedure(signature) is null then 'FAIL: function missing' else 'PASS' end as result
from functions order by signature;

with expected(policy_name,relation_name) as (values
  ('Authorized members read typed Connect rooms','connect_conversations'),
  ('Authorized members read visible Connect messages','connect_messages'),
  ('Authorized members send messages as themselves','connect_messages'),
  ('Authorized members stage their own voice files','objects'),
  ('Authorized members read linked voice files or own staged files','objects'),
  ('Authorized uploaders delete only unlinked voice files','objects'),
  ('Authorized members read linked Connect attachments','objects'),
  ('Read own authorized alerts','hub_notifications'),
  ('Mark own authorized alerts read','hub_notifications'),
  ('Read own authorized chat receipts','connect_message_reads')
)
select policy_name,case when exists(
  select 1 from pg_policies p where p.policyname=expected.policy_name
    and p.tablename=expected.relation_name
    and (expected.relation_name<>'objects' or p.schemaname='storage')
) then 'PASS' else 'FAIL: policy missing' end as result
from expected order by policy_name;

-- Dynamic SQL ensures the diagnostic still runs if the conversations table is absent.
do $$
declare d text; room_count integer; general_found integer;
begin
  if to_regclass('public.connect_conversations') is null then
    raise notice 'department_room_graphics: FAIL: conversations table missing';
    raise notice 'department_room_development: FAIL: conversations table missing';
    raise notice 'department_room_communications: FAIL: conversations table missing';
    raise notice 'department_room_events: FAIL: conversations table missing';
    raise notice 'department_room_marketing: FAIL: conversations table missing';
    raise notice 'general_room: FAIL: conversations table missing';
  else
    foreach d in array array['graphics','development','communications','events','marketing'] loop
      execute 'select count(*) from public.connect_conversations where room_type=$1 and department=$1 and member_low is null and member_high is null and archived_at is null' into room_count using d;
      raise notice 'department_room_%: %',d,case when room_count=1 then 'PASS' else 'FAIL: missing or malformed' end;
    end loop;
    execute $q$select count(*) from public.connect_conversations where id='00000000-0000-4000-8000-000000000001'::uuid and room_type='general' and member_low is null and member_high is null$q$ into general_found;
    raise notice 'general_room: %',case when general_found=1 then 'PASS' else 'FAIL: missing or malformed' end;
  end if;
end $$;

select 'Current CEO/Admin-only Connect rollout' as check_name,
  case when to_regprocedure('eba_private.connect_is_active(uuid)') is null then 'FAIL: gate missing'
       when pg_get_functiondef(to_regprocedure('eba_private.connect_is_active(uuid)')) like '%ceo%'
         and pg_get_functiondef(to_regprocedure('eba_private.connect_is_active(uuid)')) like '%admin%'
         and pg_get_functiondef(to_regprocedure('eba_private.connect_is_active(uuid)')) !~* $pattern$'(staff|hod)'$pattern$
       then 'PASS: staff/HOD remain outside Connect rollout' else 'FAIL: inspect rollout gate' end as result;

select 'Department room reminders' as check_name,
  'NOT ENABLED: bell-only reminders remain; posting is deferred until authorized room readers can be proven eligible for each meeting audience' as result;

do $$
declare bucket text; is_public boolean;
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'private_bucket_checks: FAIL: storage.buckets missing';
  else
    foreach bucket in array array['connect-voice','connect-attachments'] loop
      execute 'select "public" from storage.buckets where id=$1' into is_public using bucket;
      raise notice 'storage_bucket_%: %',bucket,case when is_public is false then 'PASS: private'
        when is_public is true then 'FAIL: bucket is public' else 'FAIL: bucket missing' end;
    end loop;
  end if;
end $$;

rollback;
