begin;
select set_config('eba_test.admin',coalesce((select id::text from auth.users where email='hub-admin-test@enibrand.com'),''),true);
select set_config('eba_test.ceo',coalesce((select id::text from auth.users where email='eba-ceo-test@enibrand.com'),''),true);
select set_config('eba_test.outsider',coalesce((select id::text from auth.users where email='eba-calendar-uninvited-test@enibrand.com'),''),true);
do $$ begin
  if current_setting('eba_test.admin')='' or current_setting('eba_test.ceo')='' or current_setting('eba_test.outsider')='' then raise exception 'Configure the three named test accounts first'; end if;
  if (select count(*) from public.staff_memberships where user_id in (current_setting('eba_test.admin')::uuid,current_setting('eba_test.ceo')::uuid,current_setting('eba_test.outsider')::uuid) and status='active' and role in ('ceo','admin'))<>3 then raise exception 'All three test accounts must be active CEOs/Admins'; end if;
end $$;
select set_config('eba_test.start',(date_trunc('day',now())+interval '3 days 10 hours')::text,true);
set local role service_role;
select set_config('eba_test.occurrence',public.calendar_mutate(current_setting('eba_test.admin')::uuid,gen_random_uuid(),'create',null,'one',null,jsonb_build_object(
  'title','DEV Calendar verification','agenda','Test only; rolled back','startsAt',current_setting('eba_test.start')::timestamptz,
  'endsAt',current_setting('eba_test.start')::timestamptz+interval '1 hour','frequency','weekly',
  'until',(current_setting('eba_test.start')::timestamptz at time zone 'Africa/Lagos')::date+21,
  'attendees',jsonb_build_array(current_setting('eba_test.ceo')),'departments',jsonb_build_array()))::text,true);
select set_config('eba_test.series',(select series_id::text from public.calendar_occurrences where id=current_setting('eba_test.occurrence')::uuid),true);
insert into public.calendar_reminders(occurrence_id,user_id,occurrence_version,lead_minutes,scheduled_for,status)
select id,current_setting('eba_test.ceo')::uuid,version,10,starts_at-interval '10 minutes','scheduled' from public.calendar_occurrences where id=current_setting('eba_test.occurrence')::uuid;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('eba_test.admin'),'email','hub-admin-test@enibrand.com','role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.calendar_occurrences where series_id=current_setting('eba_test.series')::uuid)<>4 then raise exception 'Admin must see all four weekly occurrences'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('eba_test.ceo'),'email','eba-ceo-test@enibrand.com','role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.calendar_occurrences where series_id=current_setting('eba_test.series')::uuid)<>4 then raise exception 'Invited CEO must see all occurrences'; end if;
  begin
    update public.calendar_occurrences set title='Forbidden' where id=current_setting('eba_test.occurrence')::uuid;
    raise exception 'Invitee write unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.calendar_mutate(uuid,uuid,text,uuid,text,integer,jsonb)','EXECUTE') then raise exception 'Browser must not execute the trusted mutation RPC'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('eba_test.outsider'),'email','eba-calendar-uninvited-test@enibrand.com','role','authenticated')::text,true);
do $$ begin
  if exists(select 1 from public.calendar_occurrences where series_id=current_setting('eba_test.series')::uuid or id=current_setting('eba_test.occurrence')::uuid) then raise exception 'Uninvited active account read a private meeting'; end if;
end $$;

set local role service_role;
do $$ begin
  begin
    perform public.calendar_mutate(current_setting('eba_test.ceo')::uuid,gen_random_uuid(),'cancel',current_setting('eba_test.occurrence')::uuid,'one',1,'{}');
    raise exception 'Non-organizer mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%not its organizer%' then raise; end if;
  end;
end $$;
select public.calendar_mutate(current_setting('eba_test.admin')::uuid,gen_random_uuid(),'update',current_setting('eba_test.occurrence')::uuid,'one',1,jsonb_build_object(
  'title','DEV Calendar moved','agenda','One occurrence only','startsAt',current_setting('eba_test.start')::timestamptz+interval '1 day',
  'endsAt',current_setting('eba_test.start')::timestamptz+interval '1 day 1 hour','frequency','once','until',null,
  'attendees',jsonb_build_array(current_setting('eba_test.ceo')),'departments',jsonb_build_array()));
do $$ begin
  if not exists(select 1 from public.calendar_reminders where occurrence_id=current_setting('eba_test.occurrence')::uuid and status='needs_reschedule' and scheduled_for is null and occurrence_version=2) then raise exception 'Reschedule must invalidate occurrence reminders'; end if;
  if (select count(*) from public.calendar_occurrences where series_id=current_setting('eba_test.series')::uuid and ordinal>0 and version=1)<>3 then raise exception 'One-occurrence edit changed other occurrences'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('eba_test.ceo'),'email','eba-ceo-test@enibrand.com','role','authenticated')::text,true);
do $$ begin
  if not exists(select 1 from public.calendar_occurrences where id=current_setting('eba_test.occurrence')::uuid and title='DEV Calendar moved' and starts_at=current_setting('eba_test.start')::timestamptz+interval '1 day') then raise exception 'CEO did not see rescheduling'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('eba_test.admin'),'email','hub-admin-test@enibrand.com','role','authenticated')::text,true);
do $$ begin
  if not exists(select 1 from public.calendar_occurrences where id=current_setting('eba_test.occurrence')::uuid and version=2) then raise exception 'Admin did not see rescheduling'; end if;
end $$;

set local role service_role;
select public.calendar_mutate(current_setting('eba_test.admin')::uuid,gen_random_uuid(),'cancel',current_setting('eba_test.occurrence')::uuid,'one',2,'{}');
do $$ begin
  if not exists(select 1 from public.calendar_reminders where occurrence_id=current_setting('eba_test.occurrence')::uuid and status='cancelled' and scheduled_for is null) then raise exception 'Cancellation must cancel reminders'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('eba_test.ceo'),'email','eba-ceo-test@enibrand.com','role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.calendar_occurrences where series_id=current_setting('eba_test.series')::uuid and status='scheduled' and ends_at>now())<>3 then raise exception 'CEO upcoming list did not remove cancellation'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('eba_test.admin'),'email','hub-admin-test@enibrand.com','role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.calendar_occurrences where series_id=current_setting('eba_test.series')::uuid and status='scheduled' and ends_at>now())<>3 then raise exception 'Admin upcoming list did not remove cancellation'; end if;
end $$;

set local role service_role;
select set_config('eba_test.second',(select id::text from public.calendar_occurrences where series_id=current_setting('eba_test.series')::uuid and ordinal=1),true);
select public.calendar_mutate(current_setting('eba_test.admin')::uuid,gen_random_uuid(),'update',current_setting('eba_test.second')::uuid,'remaining',1,jsonb_build_object(
  'title','DEV Remaining series moved','agenda','','startsAt',current_setting('eba_test.start')::timestamptz+interval '8 days',
  'endsAt',current_setting('eba_test.start')::timestamptz+interval '8 days 1 hour','frequency','weekly',
  'until',(current_setting('eba_test.start')::timestamptz at time zone 'Africa/Lagos')::date+22,
  'attendees',jsonb_build_array(current_setting('eba_test.ceo')),'departments',jsonb_build_array()));
do $$ begin
  if (select count(*) from public.calendar_occurrences where series_id=current_setting('eba_test.series')::uuid and ordinal>=1 and title='DEV Remaining series moved' and version=2)<>3 then raise exception 'Remaining-series edit missed future occurrences'; end if;
  if (select status from public.calendar_occurrences where id=current_setting('eba_test.occurrence')::uuid)<>'cancelled' then raise exception 'Series edit revived an explicit cancellation'; end if;
end $$;
select public.calendar_mutate(current_setting('eba_test.admin')::uuid,gen_random_uuid(),'cancel',current_setting('eba_test.second')::uuid,'remaining',2,'{}');
do $$ begin
  if exists(select 1 from public.calendar_occurrences where series_id=current_setting('eba_test.series')::uuid and status='scheduled') then raise exception 'Remaining-series cancellation failed'; end if;
end $$;
rollback;
