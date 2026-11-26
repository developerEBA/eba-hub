-- Rollback-only integration test. Run only against a disposable local Supabase
-- database after migrations through 20261121150000. Never use hosted production.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('f0000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recognition-ceo-fixture@enibrand.com','',now(),'{}','{"full_name":"Fixture CEO"}',now(),now()),
 ('f0000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recognition-admin-fixture@enibrand.com','',now(),'{}','{"full_name":"Fixture Admin"}',now(),now()),
 ('f0000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recognition-staff-one@enibrand.com','',now(),'{}','{"full_name":"Fixture One"}',now(),now()),
 ('f0000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recognition-staff-two@enibrand.com','',now(),'{}','{"full_name":"Fixture Two"}',now(),now()) on conflict(id) do nothing;
insert into public.staff_memberships(user_id,role,status) values
 ('f0000000-0000-4000-8000-000000000001','ceo','active'),('f0000000-0000-4000-8000-000000000002','admin','active'),
 ('f0000000-0000-4000-8000-000000000003','staff','active'),('f0000000-0000-4000-8000-000000000004','staff','active')
on conflict(user_id) do update set role=excluded.role,status=excluded.status;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);

do $$
declare
  ceo uuid := 'f0000000-0000-4000-8000-000000000001'; admin_id uuid := 'f0000000-0000-4000-8000-000000000002';
  staff1 uuid := 'f0000000-0000-4000-8000-000000000003'; staff2 uuid := 'f0000000-0000-4000-8000-000000000004';
  week date := date_trunc('week',(now() at time zone 'Africa/Lagos'))::date;
  closed_month date := date_trunc('month',(now() at time zone 'Africa/Lagos')-interval '1 month')::date;
  closed_year date := date_trunc('year',(now() at time zone 'Africa/Lagos')-interval '1 year')::date;
  nomination_id uuid; team_nomination uuid;
begin
  -- Admin and CEO can both nominate through period and weekly RPCs.
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  nomination_id:=public.period_recognition_nominate('employee_month',closed_month,closed_month+10,array[staff1],
    'Fixture contribution','Worked with peers','Fixture beneficiaries','Fixture result','https://example.invalid/fixture-month');
  if nomination_id is null then raise exception 'Admin period nomination failed'; end if;
  if not public.submit_weekly_recognition_nomination(week,staff1,week,'Fixture contribution','Fixture beneficiaries','Fixture result','https://example.invalid/fixture-week') then
    raise exception 'Admin weekly nomination failed'; end if;
  perform set_config('request.jwt.claim.sub',ceo::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ceo,'role','authenticated')::text,true);
  if public.period_recognition_nominate('employee_month',closed_month,closed_month+10,array[staff2],
    'Second fixture contribution','Worked with peers','Fixture beneficiaries','Fixture result','https://example.invalid/fixture-month-two') is null then raise exception 'CEO period nomination failed'; end if;
  if not public.submit_weekly_recognition_nomination(week,staff2,week,'Second contribution','Fixture beneficiaries','Fixture result','https://example.invalid/fixture-week-two') then
    raise exception 'CEO weekly nomination failed'; end if;
  team_nomination:=public.period_recognition_nominate('teamwork_year',closed_year,closed_year+20,array[staff1,staff2],
    'Team outcome','The two contributors coordinated delivery','Staff team','Improved handoff','https://example.invalid/teamwork');
  if team_nomination is null then raise exception 'Best Teamwork nomination failed'; end if;

  -- CEO submits the period review; only their own row is visible until Admin submits.
  if not public.period_recognition_review('employee_month',closed_month,nomination_id,'Impact','Contribution','Evidence') then raise exception 'CEO review failed'; end if;
  if (select count(*) from public.period_recognition_reviews where award_type='employee_month' and period_start=closed_month)<>1 then raise exception 'Period review privacy failed before both reviews'; end if;
  if not public.submit_weekly_recognition_review(week,staff1,'Impact','Contribution','Evidence') then raise exception 'CEO weekly review failed'; end if;
  if not public.period_recognition_review('teamwork_year',closed_year,team_nomination,'Impact','Contribution','Evidence') then raise exception 'CEO teamwork review failed'; end if;
  if (select count(*) from public.weekly_recognition_reviews where week_start=week)<>1 then raise exception 'Weekly review privacy failed before both reviews'; end if;

  -- Admin chooses differently: disagreement blocks both publishers.
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  if not public.period_recognition_review('employee_month',closed_month,
    (select id from public.period_recognition_nominations where award_type='employee_month' and period_start=closed_month and contributor_ids=array[staff2]),'Impact','Contribution','Evidence') then raise exception 'Admin period review failed'; end if;
  if not public.submit_weekly_recognition_review(week,staff2,'Impact','Contribution','Evidence') then raise exception 'Admin weekly review failed'; end if;
  if not public.period_recognition_review('teamwork_year',closed_year,team_nomination,'Impact','Contribution','Evidence') then raise exception 'Admin teamwork review failed'; end if;
  if (select count(*) from public.period_recognition_reviews where award_type='employee_month' and period_start=closed_month)<>2 then raise exception 'Both period reviews should be visible after submission'; end if;
  if (select count(*) from public.weekly_recognition_reviews where week_start=week)<>2 then raise exception 'Both weekly reviews should be visible after submission'; end if;
  begin perform public.period_recognition_publish('employee_month',closed_month,nomination_id,'Fixture reason'); raise exception 'Admin published period recognition'; exception when insufficient_privilege then null; end;
  begin perform public.publish_weekly_recognition(week,staff1,'Fixture reason'); raise exception 'Admin published weekly recognition'; exception when insufficient_privilege then null; end;
  begin perform public.period_recognition_publish('teamwork_year',closed_year,team_nomination,'Fixture reason'); raise exception 'Admin published teamwork recognition'; exception when insufficient_privilege then null; end;

  -- CEO can revise after both exist, then publish; retry must not duplicate.
  perform set_config('request.jwt.claim.sub',ceo::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ceo,'role','authenticated')::text,true);
  if not public.period_recognition_review('employee_month',closed_month,nomination_id,'Impact','Contribution','Evidence') then raise exception 'CEO period review revision failed'; end if;
  if not public.submit_weekly_recognition_review(week,staff1,'Impact','Contribution','Evidence') then raise exception 'CEO weekly review revision failed'; end if;
  if not public.period_recognition_publish('employee_month',closed_month,nomination_id,'Fixture public reason') then raise exception 'CEO period publish failed'; end if;
  if public.period_recognition_publish('employee_month',closed_month,nomination_id,'Duplicate retry') then raise exception 'Period duplicate publish succeeded'; end if;
  if not public.publish_weekly_recognition(week,staff1,'Fixture public reason') then raise exception 'CEO weekly publish failed'; end if;
  if public.publish_weekly_recognition(week,staff1,'Duplicate retry') then raise exception 'Weekly duplicate publish succeeded'; end if;

  -- Explicit no-award paths share the same two-review and CEO-only rule.
  perform set_config('request.jwt.claim.sub',ceo::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ceo,'role','authenticated')::text,true);
  if not public.period_recognition_review('employee_year',closed_year,null,'Impact','Contribution','Evidence') then raise exception 'CEO no-award review failed'; end if;
  if not public.period_recognition_review('teamwork_month',closed_month,null,'Impact','Contribution','Evidence') then raise exception 'CEO teamwork no-award review failed'; end if;
  -- Prior Monday gives a separate weekly no-award case.
  if not public.submit_weekly_recognition_review(week-7,null,'Impact','Contribution','Evidence') then raise exception 'CEO weekly no-award review failed'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  if not public.period_recognition_review('employee_year',closed_year,null,'Impact','Contribution','Evidence') then raise exception 'Admin no-award review failed'; end if;
  if not public.period_recognition_review('teamwork_month',closed_month,null,'Impact','Contribution','Evidence') then raise exception 'Admin teamwork no-award review failed'; end if;
  if not public.submit_weekly_recognition_review(week-7,null,'Impact','Contribution','Evidence') then raise exception 'Admin weekly no-award review failed'; end if;
  begin perform public.period_recognition_publish('employee_year',closed_year,null,'Fixture no-award'); raise exception 'Admin published period no-award'; exception when insufficient_privilege then null; end;
  begin perform public.publish_weekly_recognition(week-7,null,'Fixture no-award'); raise exception 'Admin published weekly no-award'; exception when insufficient_privilege then null; end;
  begin perform public.period_recognition_publish('teamwork_month',closed_month,null,'Fixture no-award'); raise exception 'Admin published teamwork no-award'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',ceo::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ceo,'role','authenticated')::text,true);
  if not public.period_recognition_publish('employee_year',closed_year,null,'Fixture no-award') then raise exception 'CEO period no-award publish failed'; end if;
  if not public.publish_weekly_recognition(week-7,null,'Fixture no-award') then raise exception 'CEO weekly no-award publish failed'; end if;
  if not public.period_recognition_publish('teamwork_month',closed_month,null,'Fixture no-award') then raise exception 'CEO teamwork no-award publish failed'; end if;
  if not public.period_recognition_publish('teamwork_year',closed_year,team_nomination,'Fixture teamwork reason') then raise exception 'CEO teamwork publish failed'; end if;
  if public.period_recognition_publish('teamwork_year',closed_year,team_nomination,'Duplicate retry') then raise exception 'Teamwork duplicate publish succeeded'; end if;
end;
$$;
rollback;
