begin transaction read only;

select check_name,case when exists(select 1 from pg_class where oid=to_regclass(object_name))
  then 'PASS' else 'FAIL' end as result
from (values
  ('Connect conversations','public.connect_conversations'),
  ('Connect messages','public.connect_messages'),
  ('Connect profiles','public.connect_profiles'),
  ('Staff memberships','public.staff_memberships'),
  ('Staff department assignments','public.staff_department_assignments'),
  ('Staff access profiles','public.staff_access_profiles')
) expected(check_name,object_name)
order by check_name;
select c.id,
  case c.id
    when '00000000-0000-4000-8000-000000000002'::uuid then 'graphics'
    when '00000000-0000-4000-8000-000000000003'::uuid then 'development'
    when '00000000-0000-4000-8000-000000000004'::uuid then 'communications'
    when '00000000-0000-4000-8000-000000000005'::uuid then 'events'
    when '00000000-0000-4000-8000-000000000006'::uuid then 'marketing'
    else 'unmapped'
  end as known_department,
  count(m.id) as historical_message_count,
  case when c.id='00000000-0000-4000-8000-000000000001'::uuid then 'preserve General'
       when count(m.id)>0 then 'archive shared history; make fresh private room'
       when c.id in ('00000000-0000-4000-8000-000000000002'::uuid,
                     '00000000-0000-4000-8000-000000000003'::uuid,
                     '00000000-0000-4000-8000-000000000004'::uuid,
                     '00000000-0000-4000-8000-000000000005'::uuid,
                     '00000000-0000-4000-8000-000000000006'::uuid)
         then 'convert empty room using explicit shipped ID mapping'
       else 'archive unmapped shared room; manual review required' end as planned_action
from public.connect_conversations c
left join public.connect_messages m on m.conversation_id=c.id
where c.member_low is null and c.member_high is null
group by c.id
order by c.id;

rollback;
