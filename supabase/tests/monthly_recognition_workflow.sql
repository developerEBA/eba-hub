-- Rollback-only integration test for the current three monthly awards.
-- Run only against the disposable local Supabase database (port 54322).
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('f1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','monthly-ceo-fixture@enibrand.com','',now(),'{}','{"full_name":"Fixture CEO"}',now(),now()),
 ('f1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','monthly-admin-fixture@enibrand.com','',now(),'{}','{"full_name":"Fixture Admin"}',now(),now()),
 ('f1000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','monthly-staff-one-fixture@enibrand.com','',now(),'{}','{"full_name":"Fixture One"}',now(),now()),
 ('f1000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','monthly-staff-two-fixture@enibrand.com','',now(),'{}','{"full_name":"Fixture Two"}',now(),now()),
 ('f1000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','monthly-staff-three-fixture@enibrand.com','',now(),'{}','{"full_name":"Fixture Three"}',now(),now()) on conflict(id) do nothing;
insert into public.staff_memberships(user_id,role,status) values
 ('f1000000-0000-4000-8000-000000000001','ceo','active'),
 ('f1000000-0000-4000-8000-000000000002','admin','active'),
 ('f1000000-0000-4000-8000-000000000003','staff','active'),
 ('f1000000-0000-4000-8000-000000000004','staff','active'),
 ('f1000000-0000-4000-8000-000000000005','staff','active')
on conflict(user_id) do update set role=excluded.role,status=excluded.status;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);

do $$
declare
  ceo uuid := 'f1000000-0000-4000-8000-000000000001';
  admin_id uuid := 'f1000000-0000-4000-8000-000000000002';
  staff1 uuid := 'f1000000-0000-4000-8000-000000000003';
  staff2 uuid := 'f1000000-0000-4000-8000-000000000004';
  staff3 uuid := 'f1000000-0000-4000-8000-000000000005';
  month_start date := date_trunc('month',(now() at time zone 'Africa/Lagos')-interval '1 month')::date;
  no_award_month date := date_trunc('month',(now() at time zone 'Africa/Lagos')-interval '2 months')::date;
  admin_employee uuid; ceo_employee uuid; admin_team uuid; ceo_team uuid; admin_improved uuid; ceo_improved uuid;
begin
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  if (select count(*) from public.period_recognition_reviews where award_type='employee_month' and period_start=month_start)<>0 then raise exception 'Admin saw the CEO review before submitting'; end if;

  admin_employee := public.period_recognition_nominate('employee_month',month_start,month_start+10,array[staff1],
    'Contribution','Collaborated with colleagues','The team','Improved delivery','https://example.invalid/employee-admin');
  admin_team := public.period_recognition_nominate('teamwork_month',month_start,month_start+10,array[staff1,staff2],
    'Shared contribution','Coordinated handoffs','The team','Reduced rework','https://example.invalid/team-admin');
  admin_improved := public.period_recognition_nominate('most_improved_month',month_start,month_start+10,array[staff1],
    'Contribution','Worked with peers','The team','Improved delivery','https://example.invalid/improved-admin',
    month_start+1,month_start+8,'Before evidence','After evidence');
  if admin_employee is null or admin_team is null or admin_improved is null then raise exception 'Admin monthly nomination failed'; end if;
  if public.period_recognition_nominate('teamwork_month',month_start,month_start+10,array[staff1],
    'Contribution','Worked together','The team','Result','https://example.invalid/team-single') is not null then raise exception 'Single-contributor Best Teamwork nomination was accepted'; end if;
  if public.period_recognition_nominate('most_improved_month',month_start,month_start+10,array[staff2],
    'Contribution','Worked with peers','The team','Result','https://example.invalid/improved-missing',null,month_start+8,null,'After') is not null then raise exception 'Missing Most Improved evidence was accepted'; end if;
  if public.period_recognition_nominate('most_improved_month',month_start,month_start+10,array[staff2],
    'Contribution','Worked with peers','The team','Result','https://example.invalid/improved-blank',
    month_start+1,month_start+8,'  ','After') is not null then raise exception 'Blank Most Improved evidence was accepted'; end if;
  if public.period_recognition_nominate('most_improved_month',month_start,month_start+10,array[staff2],
    'Contribution','Worked with peers','The team','Result','https://example.invalid/improved-reversed',
    month_start+8,month_start+1,'Before','After') is not null then raise exception 'Reversed Most Improved dates were accepted'; end if;
  begin
    perform public.period_recognition_nominate('most_improved_month',month_start,month_start+10,array[staff2],
      'Contribution','Worked with peers','The team','Result','https://example.invalid/improved-before-outside',
      month_start-1,month_start+1,'Before','After');
    raise exception 'Out-of-month before date was accepted';
  exception when check_violation then null; end;
  if public.period_recognition_nominate('most_improved_month',month_start,month_start+10,array[staff2],
    'Contribution','Worked with peers','The team','Result','https://example.invalid/improved-after-outside',
    month_start+1,month_start+31,'Before','After') is not null then raise exception 'Out-of-month after date was accepted'; end if;

  perform set_config('request.jwt.claim.sub',ceo::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ceo,'role','authenticated')::text,true);
  ceo_employee := public.period_recognition_nominate('employee_month',month_start,month_start+11,array[staff2],
    'Second contribution','Shared delivery','The team','Improved delivery','https://example.invalid/employee-ceo');
  ceo_team := public.period_recognition_nominate('teamwork_month',month_start,month_start+11,array[staff2,staff3],
    'Second team contribution','Coordinated delivery','The team','Improved handoff','https://example.invalid/team-ceo');
  ceo_improved := public.period_recognition_nominate('most_improved_month',month_start,month_start+11,array[staff2],
    'Second contribution','Worked with peers','The team','Improved delivery','https://example.invalid/improved-ceo',
    month_start+2,month_start+9,'Before evidence','After evidence');
  if ceo_employee is null or ceo_team is null or ceo_improved is null then raise exception 'CEO monthly nomination failed'; end if;

  if not public.period_recognition_review('employee_month',month_start,ceo_employee,'Impact','Contribution','Evidence') then raise exception 'CEO employee review failed'; end if;
  if (select count(*) from public.period_recognition_reviews where award_type='employee_month' and period_start=month_start)<>1 then raise exception 'CEO review was visible before Admin review'; end if;
  if not public.period_recognition_review('teamwork_month',month_start,ceo_team,'Impact','Contribution','Evidence') then raise exception 'CEO teamwork review failed'; end if;
  if not public.period_recognition_review('most_improved_month',month_start,ceo_improved,'Impact','Contribution','Evidence') then raise exception 'CEO Most Improved review failed'; end if;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  if not public.period_recognition_review('employee_month',month_start,admin_employee,'Impact','Contribution','Evidence') then raise exception 'Admin employee review failed'; end if;
  if (select count(*) from public.period_recognition_reviews where award_type='employee_month' and period_start=month_start)<>2 then raise exception 'Both independent reviews not visible after submission'; end if;
  if not public.period_recognition_review('teamwork_month',month_start,ceo_team,'Impact','Contribution','Evidence') then raise exception 'Admin teamwork review failed'; end if;
  if not public.period_recognition_review('most_improved_month',month_start,ceo_improved,'Impact','Contribution','Evidence') then raise exception 'Admin Most Improved review failed'; end if;
  begin perform public.period_recognition_publish('employee_month',month_start,ceo_employee,'Admin direct RPC'); raise exception 'Admin published employee result'; exception when insufficient_privilege then null; end;
  begin perform public.period_recognition_publish('employee_month',month_start,null,'Admin direct no-award RPC'); raise exception 'Admin published a no-award result directly'; exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub',ceo::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ceo,'role','authenticated')::text,true);
  if public.period_recognition_publish('employee_month',month_start,ceo_employee,'Disagreement') then raise exception 'Disagreement allowed publication'; end if;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  if not public.period_recognition_review('employee_month',month_start,ceo_employee,'Impact','Contribution','Evidence') then raise exception 'Admin could not revise own review after both submitted'; end if;
  if public.period_recognition_review('employee_year',month_start,null,'Impact','Contribution','Evidence') then raise exception 'Retired category accepted a review'; end if;
  if public.period_recognition_nominate('employee_year',date_trunc('year',month_start)::date,month_start,array[staff1],
    'Retired','Retired','Retired','Retired','https://example.invalid/retired') is not null then raise exception 'Retired category accepted a nomination'; end if;
  if public.period_recognition_nominate('teamwork_year',date_trunc('year',month_start)::date,month_start,array[staff1,staff2],
    'Retired','Retired','Retired','Retired','https://example.invalid/retired-team') is not null then raise exception 'Retired teamwork category accepted a nomination'; end if;
  begin perform public.period_recognition_publish('employee_year',date_trunc('year',month_start)::date,null,'Admin retired'); raise exception 'Admin reached retired publication RPC'; exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub',ceo::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ceo,'role','authenticated')::text,true);
  if not public.period_recognition_publish('employee_month',month_start,ceo_employee,'Agreed employee result') then raise exception 'CEO could not publish after agreement'; end if;
  if public.period_recognition_publish('employee_month',month_start,ceo_employee,'Repeated request') then raise exception 'Repeated employee publication created a result'; end if;
  if (select count(*) from public.period_recognition_results where award_type='employee_month' and period_start=month_start)<>1 then raise exception 'Employee result was duplicated'; end if;
  if not public.period_recognition_publish('teamwork_month',month_start,ceo_team,'Agreed team result') then raise exception 'CEO could not publish Best Teamwork'; end if;
  if not public.period_recognition_publish('most_improved_month',month_start,ceo_improved,'Agreed improvement result') then raise exception 'CEO could not publish Most Improved'; end if;
  if public.period_recognition_publish('employee_year',date_trunc('year',month_start)::date,null,'CEO retired') then raise exception 'CEO published a retired category'; end if;
  if public.period_recognition_publish('teamwork_year',date_trunc('year',month_start)::date,null,'CEO retired') then raise exception 'CEO published retired teamwork'; end if;

  if not public.period_recognition_review('employee_month',no_award_month,null,'Impact','Contribution','Evidence') then raise exception 'CEO no-award review failed'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  if not public.period_recognition_review('employee_month',no_award_month,null,'Impact','Contribution','Evidence') then raise exception 'Admin no-award review failed'; end if;
  begin perform public.period_recognition_publish('employee_month',no_award_month,null,'Admin no-award'); raise exception 'Admin published no-award'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',ceo::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ceo,'role','authenticated')::text,true);
  if not public.period_recognition_publish('employee_month',no_award_month,null,'Agreed no-award result') then raise exception 'CEO could not publish agreed no-award'; end if;
  if public.period_recognition_publish('employee_month',no_award_month,null,'Repeated no-award') then raise exception 'Repeated no-award publication created a result'; end if;
  if not exists(select 1 from public.period_recognition_results where award_type='employee_month' and period_start=no_award_month and outcome='no_award') then raise exception 'No-award result missing from published history'; end if;
end;
$$;

rollback;
