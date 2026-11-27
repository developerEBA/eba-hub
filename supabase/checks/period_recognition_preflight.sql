with expected(name, relation_name) as (
  values ('nominations','period_recognition_nominations'),
         ('reviews','period_recognition_reviews'),
         ('results','period_recognition_results'),
         ('monthly nominations','period_recognition_nominations'),
         ('monthly reviews','period_recognition_reviews'),
         ('monthly results','period_recognition_results')
)
select e.name,
       to_regclass('public.' || e.relation_name) as relation,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls
from expected e
left join pg_class c on c.oid=to_regclass('public.' || e.relation_name)
order by e.name;

select expected.signature, to_regprocedure(expected.signature) as function
from (values
  ('public.period_recognition_candidates()'),
  ('public.period_recognition_nominate(text,date,date,uuid[],text,text,text,text,text,date,date,text,text)'),
  ('public.period_recognition_review(text,date,uuid,text,text,text)'),
  ('public.period_recognition_publish(text,date,uuid,text)'),
  ('public.period_recognition_winner_profiles(text,date)')
) expected(signature);

select current_setting('TimeZone') as session_timezone,
       now() at time zone 'Africa/Lagos' as lagos_now,
       'No objects are changed by this preflight.' as note;
