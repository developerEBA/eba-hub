-- Combined read-only diagnostic for the three active monthly recognition categories.
-- Historical weekly/yearly records are retained but excluded from active RPC scope.
begin transaction read only;
with expected_relations as (
  select name,to_regclass('public.'||name) as relation_oid
  from (values ('period_recognition_nominations'),('period_recognition_reviews'),('period_recognition_results')) v(name)
), relation_checks as (
  select bool_and(relation_oid is not null) as present,
    bool_and(relation_oid is not null and coalesce(c.relrowsecurity,false)) as rls_enabled
  from expected_relations e left join pg_class c on c.oid=e.relation_oid
), expected_functions as (
  select signature,to_regprocedure(signature) as procedure_oid
  from (values ('public.period_recognition_candidates()'),
    ('public.period_recognition_nominate(text,date,date,uuid[],text,text,text,text,text,date,date,text,text)'),
    ('public.period_recognition_review(text,date,uuid,text,text,text)'),
    ('public.period_recognition_publish(text,date,uuid,text)'),
    ('public.period_recognition_winner_profiles(text,date)')) v(signature)
), function_checks as (
  select bool_and(procedure_oid is not null) as present,
    bool_and(case when procedure_oid is null then false else
      case when signature like '%nominate%' or signature like '%review%' then pg_get_functiondef(procedure_oid::oid) ilike '%hub_is_active%'
      when signature like '%publish%' then pg_get_functiondef(procedure_oid::oid) ilike '%role=''ceo''%' and pg_get_functiondef(procedure_oid::oid) not ilike '%recognition_admin%'
      when signature like '%winner_profiles%' then pg_get_functiondef(procedure_oid::oid) ilike '%hub_is_active%' and pg_get_functiondef(procedure_oid::oid) ilike '%outcome=''winner''%'
      else true end end) as role_gates,
    bool_and(case when procedure_oid is null then false when signature like '%candidates%' or signature like '%winner_profiles%' then true else pg_get_functiondef(procedure_oid::oid) ilike '%pg_advisory_xact_lock%' end) as locks
  from expected_functions
), policy_checks as (
  select exists(select 1 from pg_policy where polrelid=to_regclass('public.period_recognition_nominations') and polname='Active executives read period recognition nominations')
    and exists(select 1 from pg_policy where polrelid=to_regclass('public.period_recognition_reviews') and polname='Reviewers see own period review until both submit')
    and exists(select 1 from pg_policy where polrelid=to_regclass('public.period_recognition_results') and polname='Active executives read published period recognition') as ok
), evidence_check as (
  select exists(
    select 1 from pg_constraint
    where conrelid=to_regclass('public.period_recognition_nominations')
      and conname='period_recognition_improvement_evidence_check'
      and convalidated
      and pg_get_constraintdef(oid) ilike '%before_date IS NOT NULL%'
      and pg_get_constraintdef(oid) ilike '%after_date IS NOT NULL%'
      and pg_get_constraintdef(oid) ilike '%before_evidence IS NOT NULL%'
      and pg_get_constraintdef(oid) ilike '%after_evidence IS NOT NULL%'
      and pg_get_constraintdef(oid) ilike '%before_date < after_date%'
      and pg_get_constraintdef(oid) ilike '%before_date >= period_start%'
      and pg_get_constraintdef(oid) ilike '%before_date < (period_start +%'
      and pg_get_constraintdef(oid) ilike '%after_date >= period_start%'
      and pg_get_constraintdef(oid) ilike '%after_date < (period_start +%'
      and pg_get_constraintdef(oid) ilike '%length(btrim(before_evidence%'
      and pg_get_constraintdef(oid) ilike '%length(btrim(after_evidence%'
      and pg_get_constraintdef(oid) ilike '%before_evidence%1200%'
      and pg_get_constraintdef(oid) ilike '%after_evidence%1200%'
  ) as ok
), old_category_gate as (
  select bool_and(pg_get_functiondef(procedure_oid::oid) ilike '%most_improved_month%'
    and pg_get_functiondef(procedure_oid::oid) not ilike '%employee_year%') as ok
  from expected_functions where signature in (
    'public.period_recognition_nominate(text,date,date,uuid[],text,text,text,text,text,date,date,text,text)',
    'public.period_recognition_review(text,date,uuid,text,text,text)',
    'public.period_recognition_publish(text,date,uuid,text)') and procedure_oid is not null
)
select case when coalesce((select present and rls_enabled from relation_checks),false)
  and coalesce((select present and role_gates and locks from function_checks),false)
  and coalesce((select ok from policy_checks),false) and coalesce((select ok from evidence_check),false)
  and coalesce((select ok from old_category_gate),false) then 'PASS' else 'FAIL' end as status,
 jsonb_build_object(
   'recognition_tables_present_and_rls_enabled',coalesce((select present and rls_enabled from relation_checks),false),
   'monthly_rpc_presence_role_gates_and_locks',coalesce((select present and role_gates and locks from function_checks),false),
   'review_privacy_and_published_result_policies',coalesce((select ok from policy_checks),false),
   'most_improved_named_dated_evidence_constraint_validated',coalesce((select ok from evidence_check),false),
   'retired_categories_rejected_by_active_rpcs',coalesce((select ok from old_category_gate),false),
   'live_behavior','Not proven by catalog inspection; test with distinct active CEO and Admin accounts') as checks;
rollback;
