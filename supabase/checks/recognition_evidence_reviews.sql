begin;

select set_config('eba_test.ceo', coalesce((select id::text from auth.users where email = 'eba-ceo-test@enibrand.com'), ''), true);
select set_config('eba_test.admin', coalesce((select id::text from auth.users where email = 'hub-admin-test@enibrand.com'), ''), true);
select set_config('eba_test.nominee', coalesce((select id::text from auth.users where email = 'eba-recognition-test@enibrand.com'), ''), true);

do $$
declare
  test_week date;
  nominee uuid := nullif(current_setting('eba_test.nominee'), '')::uuid;
begin
  if nominee is null or current_setting('eba_test.ceo') = '' or current_setting('eba_test.admin') = '' then
    raise exception 'Create the three development accounts first';
  end if;
  select candidate.week_start into test_week
  from (
    select date_trunc('week', now() at time zone 'Africa/Lagos')::date - offset_week * 7 as week_start
    from generate_series(0, 52) offset_week
  ) candidate
  where not exists (select 1 from public.weekly_recognition where week_start = candidate.week_start)
    and not exists (select 1 from public.weekly_recognition_reviews where week_start = candidate.week_start)
    and not exists (select 1 from public.weekly_recognition_nominations where week_start = candidate.week_start)
  order by candidate.week_start desc limit 1;
  if test_week is null then raise exception 'No unused development week'; end if;
  perform set_config('eba_test.week', test_week::text, true);

  insert into public.weekly_recognition_nominations
    (week_start, nominee_id, what_they_did, who_benefited, what_changed)
  values (test_week, nominee, 'DEV: improved a checklist', 'DEV: delivery team', 'DEV: fewer missed handoffs');
end;
$$;

set local role authenticated;

do $$
declare
  week date := current_setting('eba_test.week')::date;
  nominee uuid := current_setting('eba_test.nominee')::uuid;
  ceo text := current_setting('eba_test.ceo');
  admin text := current_setting('eba_test.admin');
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin, 'role', 'authenticated')::text, true);
  if public.publish_weekly_recognition(week, nominee, 'Old RPC bypass attempt') then
    raise exception 'Publishing without reviews succeeded';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', ceo, 'role', 'authenticated')::text, true);
  if not public.submit_weekly_recognition_review(week, nominee, 'Impact', 'Contribution', 'Evidence') then
    raise exception 'Initial CEO review failed';
  end if;
  if public.submit_weekly_recognition_review(week, null, 'Impact', 'Contribution', 'Evidence') then
    raise exception 'CEO revised before both submitted';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.weekly_recognition_reviews where week_start = week) then
    raise exception 'The first review was visible to the other reviewer';
  end if;
  if public.publish_weekly_recognition(week, nominee, 'One review bypass attempt') then
    raise exception 'Publishing with one review succeeded';
  end if;
  if not public.submit_weekly_recognition_review(week, null, 'Impact', 'Contribution', 'Evidence') then
    raise exception 'Initial Admin review failed';
  end if;
  if (select count(*) from public.weekly_recognition_reviews where week_start = week) <> 2 then
    raise exception 'Both submitted reviews should now be visible';
  end if;
  if public.publish_weekly_recognition(week, nominee, 'Disagreement bypass attempt') then
    raise exception 'Publishing while reviewers disagreed succeeded';
  end if;
  if not public.submit_weekly_recognition_review(week, nominee, 'Revised impact', 'Contribution', 'Evidence') then
    raise exception 'Admin revision after both reviews failed';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', ceo, 'role', 'authenticated')::text, true);
  begin
    perform public.publish_weekly_recognition(week, nominee, 'CEO bypass attempt');
    raise exception 'CEO publish RPC did not deny access';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin, 'role', 'authenticated')::text, true);
  if not public.publish_weekly_recognition(week, nominee, 'Verified contribution') then
    raise exception 'Admin could not publish the agreed nominee';
  end if;
  if public.publish_weekly_recognition(week, nominee, 'Duplicate award attempt')
     or public.submit_weekly_recognition_review(week, null, 'Impact', 'Contribution', 'Evidence') then
    raise exception 'The published week was not locked';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', ceo, 'role', 'authenticated')::text, true);
  if not exists (
    select 1 from public.weekly_recognition where week_start = week
      and winner_id = nominee and reason = 'Verified contribution'
  ) then raise exception 'CEO could not read the published result'; end if;

  raise notice 'Recognition checks passed';
end;
$$;

rollback;
