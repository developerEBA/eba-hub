-- Combined CEO/Admin dashboard schema and access diagnostic.
-- Run in Supabase SQL Editor as postgres. Read-only: no records are changed.
-- Every expected object is reported by name; absent migrations yield FAIL rows.
begin transaction read only;

with expected(feature, object_name, needs_rls) as (values
  ('Authentication', 'staff_memberships', true),
  ('Staff access', 'staff_access_invites', true),
  ('Staff access', 'staff_access_profiles', true),
  ('Staff access', 'staff_access_audit', true),
  ('Department Plans', 'department_plans', true),
  ('Department Plans', 'department_plan_items', true),
  ('Department Plans', 'department_plan_attachments', true),
  ('Approvals', 'approval_requests', true),
  ('Connect', 'connect_profiles', true),
  ('Connect', 'connect_conversations', true),
  ('Connect', 'connect_messages', true),
  ('Connect', 'hub_notifications', true),
  ('Connect', 'connect_message_reads', true),
  ('Recognition', 'weekly_recognition', true),
  ('Recognition', 'weekly_recognition_nominations', true),
  ('Recognition', 'weekly_recognition_reviews', true),
  ('Recognition', 'period_recognition_nominations', true),
  ('Recognition', 'period_recognition_reviews', true),
  ('Recognition', 'period_recognition_results', true),
  ('Clients', 'client_directory', true),
  ('Client portal', 'client_portal_invites', true),
  ('Client portal', 'client_portal_access', true),
  ('Client portal', 'client_portal_shares', true),
  ('Client portal', 'client_portal_audit', true),
  ('Client portal', 'client_conversation_messages', true),
  ('Games', 'game_rooms', true),
  ('Games', 'game_nights', true),
  ('Calendar', 'calendar_series', true),
  ('Calendar', 'calendar_occurrences', true),
  ('Calendar', 'calendar_sync_jobs', true),
  ('Calendar', 'calendar_reminders', true),
  ('Calendar import', 'calendar_google_import_state', true),
  ('Google organizer', 'google_organizer_connection', true),
  ('Call closure', 'calendar_call_end_jobs', true),
  ('Call closure', 'calendar_call_end_space_leases', true),
  ('Client cleanup', 'client_file_cleanup', true)
), inspected as (
  select e.feature, e.object_name, e.needs_rls,
         to_regclass(format('public.%I', e.object_name)) as relation_oid
  from expected e
)
select feature, object_name,
       case
         when relation_oid is null then 'FAIL: missing object/migration'
         when needs_rls and not (select c.relrowsecurity from pg_class c where c.oid = relation_oid)
           then 'FAIL: RLS disabled'
         else 'PASS: exists; RLS ' || case when (select c.relrowsecurity from pg_class c where c.oid = relation_oid) then 'enabled' else 'not required' end
       end as result
from inspected
order by feature, object_name;

with expected(bucket_id) as (values
  ('department-plan-files'), ('connect-voice'), ('connect-attachments'), ('client-shared-files')
)
select 'Storage bucket ' || e.bucket_id as check_name,
       case when b.id is null then 'FAIL: missing bucket' when b.public then 'FAIL: bucket is public'
            else 'PASS: private bucket exists' end as result
from expected e left join storage.buckets b on b.id = e.bucket_id
order by e.bucket_id;

select 'Department group privacy' as check_name,
       'NOT IMPLEMENTED: current department rooms use shared General-style membership; NULL member_low does not enforce department privacy' as result;

rollback;
