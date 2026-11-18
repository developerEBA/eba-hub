-- ROLLBACK-ONLY integration test for a disposable/staging database, after migration.
-- Pause workers. Uses two EXISTING verified active CEO/Admin accounts, creates no
-- accounts, calls no Google API, commits no notifications. Do not run alongside
-- live delivery: it holds transaction locks until rollback.
begin;
set local role service_role;
do $$
declare a uuid; b uuid; c uuid; s uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); x uuid:=gen_random_uuid();
  t timestamptz:=statement_timestamp()+interval '3 hours'; n integer; revision integer;
begin
 select user_id into a from public.staff_memberships where role='admin' and public.calendar_reminder_account_active(user_id) order by user_id limit 1;
 select user_id into b from public.staff_memberships where role='ceo' and public.calendar_reminder_account_active(user_id) order by user_id limit 1;
 if a is null or b is null then raise exception 'Two existing verified active Admin/CEO accounts required'; end if;
 insert into public.calendar_series(id,organizer_id,frequency,recurrence_until) values(s,a,'weekly',(t+interval '7 days')::date);
 insert into public.calendar_occurrences(id,series_id,organizer_id,ordinal,original_starts_at,title,starts_at,ends_at,frequency,recurrence_until,attendee_ids)
 values(o,s,a,0,t,'REMINDER ROLLBACK TEST',t,t+interval '1 hour','weekly',(t+interval '7 days')::date,array[b]),
 (w,s,a,1,t+interval '7 days','REMINDER ROLLBACK TEST',t+interval '7 days',t+interval '7 days 1 hour','weekly',(t+interval '7 days')::date,array[b]);
 select count(*) into n from public.calendar_reminders where occurrence_id=o and status='scheduled';
 if n<>6 then raise exception 'Expected exactly three stages for each of two people'; end if;
 perform public.calendar_deliver_reminders(t-interval '1 hour');
 perform public.calendar_deliver_reminders(t-interval '1 hour');
 select count(*) into n from public.hub_notifications where calendar_occurrence_id=o;
 if n<>2 then raise exception 'Hour stage retry dedup failed'; end if;
 perform public.calendar_deliver_reminders(t-interval '10 minutes');
 perform public.calendar_deliver_reminders(t);
 select count(*) into n from public.hub_notifications where calendar_occurrence_id=o;
 if n<>6 then raise exception 'Three stages failed'; end if;
 if exists(select 1 from public.hub_notifications where calendar_occurrence_id=w) then raise exception 'Weekly occurrence leaked stages'; end if;
 -- Time changes invalidate old jobs without touching another weekly occurrence.
 update public.calendar_occurrences set starts_at=t+interval '2 hours',ends_at=t+interval '3 hours',version=version+1 where id=o;
 select reminder_revision into revision from public.calendar_occurrences where id=o;
 if revision<>2 then raise exception 'Schedule revision did not advance'; end if;
 if exists(select 1 from public.calendar_reminders where occurrence_id=o and schedule_revision=1 and status='scheduled') then raise exception 'Obsolete jobs remain'; end if;
 -- A title edit must not restart stages or change the schedule revision.
 update public.calendar_occurrences set title='REMINDER EDIT TEST',version=version+1 where id=o;
 if (select reminder_revision from public.calendar_occurrences where id=o)<>revision then raise exception 'Title changed schedule revision'; end if;
 update public.calendar_occurrences set status='cancelled',version=version+1 where id=o;
 if exists(select 1 from public.calendar_reminders where occurrence_id=o and status='scheduled') then raise exception 'Cancellation left pending delivery'; end if;
 -- Worker recovery beyond grace never sends any stale stage for the weekly row.
 perform public.calendar_deliver_reminders(t+interval '7 days 3 minutes');
 if exists(select 1 from public.hub_notifications where calendar_occurrence_id=w) then raise exception 'Downtime sent stale reminder'; end if;
 -- Inactive participant: real account eligibility, no new account creation.
 insert into public.calendar_occurrences(id,series_id,organizer_id,ordinal,original_starts_at,title,starts_at,ends_at,frequency,recurrence_until,attendee_ids)
 values(x,s,a,2,t+interval '14 days','REMINDER ELIGIBILITY TEST',t+interval '14 days',t+interval '14 days 1 hour','weekly',(t+interval '14 days')::date,array[b]);
 update public.staff_memberships set status='inactive' where user_id=b;
 perform public.calendar_deliver_reminders(t+interval '14 days'-interval '1 hour');
 if exists(select 1 from public.hub_notifications where calendar_occurrence_id=x and recipient_id=b) then raise exception 'Inactive attendee received a stage'; end if;
 if not exists(select 1 from public.hub_notifications where calendar_occurrence_id=x and recipient_id=a) then raise exception 'Organizer stage missing'; end if;
 update public.staff_memberships set status='active' where user_id=b;
 -- Test removal only when a third existing eligible account is available.
 select user_id into c from public.staff_memberships where user_id not in(a,b) and public.calendar_reminder_account_active(user_id) order by user_id limit 1;
 if c is not null then
   update public.calendar_occurrences set attendee_ids=array[c],version=version+1 where id=x;
   if exists(select 1 from public.calendar_reminders where occurrence_id=x and user_id=b and status='scheduled') then raise exception 'Removed attendee retains scheduled stages'; end if;
 else raise notice 'Active outsider/attendee replacement needs a third existing account; not tested'; end if;
 -- A real authenticated account's old alerts and occurrences disappear on deactivation.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'email',(select email from auth.users where id=b),'role','authenticated')::text,true);
 update public.staff_memberships set status='inactive' where user_id=b;
 perform set_config('eba.reminder_test_occurrence',o::text,true);
 raise notice 'Rollback-only scheduling/dedup/revision/cancellation/weekly/recovery assertions passed';
end $$;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.calendar_occurrences where id=current_setting('eba.reminder_test_occurrence')::uuid)
   or exists(select 1 from public.hub_notifications where calendar_occurrence_id=current_setting('eba.reminder_test_occurrence')::uuid)
 then raise exception 'Inactive authenticated account can read old meeting or alert'; end if;
end $$;
rollback;
