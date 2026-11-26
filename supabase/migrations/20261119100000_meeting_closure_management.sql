-- Forward-only reconciliation of occurrence closure. No Google requests.
begin;
alter table public.calendar_occurrences drop constraint calendar_occurrences_call_end_status_check;
alter table public.calendar_occurrences add constraint calendar_occurrences_call_end_status_check
 check(call_end_status in('not_requested','pending','retry','ended','no_active_call','unavailable','shared_space','reconnect_required'));
-- Retain the existing lock/version/shared-space implementation behind a stricter entry point.
alter function public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb) rename to calendar_call_end_control_v1;
create function public.calendar_call_end_control(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}')
 returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='1s' as $$
declare o public.calendar_occurrences;j public.calendar_call_end_jobs;result jsonb;
 prior text:=coalesce(current_setting('eba.google_import',true),'');v_reason text:=p_data->>'reason';
begin
 if p_action='request' then
  select * into o from public.calendar_occurrences where id=p_id for update;
  if not found then return null; end if;
  -- Executive read access does not grant management of another organizer's meeting.
  if o.organizer_id is distinct from p_actor or not public.calendar_reminder_account_active(p_actor)
   or not exists(select 1 from public.staff_memberships where user_id=p_actor and role='admin' and status='active')
   then raise exception 'Authorized Admin organizer required'; end if;
  if o.provider_event_id is null or not exists(select 1 from public.google_organizer_connection g
    where g.singleton=true and g.email=o.provider_calendar_id) then raise exception 'Configured Google ownership required'; end if;
  select * into j from public.calendar_call_end_jobs where occurrence_id=o.id for update;
  -- Repeated/concurrent confirmed requests are idempotent; never end a restarted call.
  if j.state in('ended','no_active_call') then return jsonb_build_object('state',j.state); end if;
 end if;
 result:=public.calendar_call_end_control_v1(p_action,p_id,p_actor,p_lease,p_data);
 if result is null then return null; end if;
 if p_action='request' and j.state in('unavailable','shared_space') then
  update public.calendar_call_end_jobs set attempts=0 where occurrence_id=p_id;
 end if;
 if p_action='claim' then
  -- Persist an overdue Hub closure before any Google/auth network operation.
  select * into o from public.calendar_occurrences where id=(result->'meeting'->>'id')::uuid for update;
  if o.ends_at+interval '3 hours'<=clock_timestamp() then
   perform set_config('eba.google_import','on',true);
   update public.calendar_occurrences set joining_closed_at=coalesce(joining_closed_at,ends_at+interval '3 hours'),call_end_status='pending' where id=o.id;
   perform set_config('eba.google_import',prior,true);
  end if;
 elsif p_action='finish' then
  select * into j from public.calendar_call_end_jobs where occurrence_id=p_id for update;
  if j.state='retry' then
   -- Bounded exponential retries: 1,2,4,8,15,15,15 minutes, then require manager action.
   update public.calendar_call_end_jobs set
    state=case when attempts>=8 then 'unavailable' else 'retry' end,
    reason=case when attempts>=8 then 'retry_exhausted' else calendar_call_end_jobs.reason end,
    next_attempt_at=case when attempts>=8 then 'infinity'::timestamptz
     else clock_timestamp()+make_interval(secs=>least(900,60*power(2,least(attempts-1,4)))::integer) end
    where occurrence_id=p_id;
   if j.attempts>=8 then
    perform set_config('eba.google_import','on',true);
    update public.calendar_occurrences set call_end_status='unavailable' where id=p_id;
    perform set_config('eba.google_import',prior,true);
   end if;
  elsif j.state in('unavailable','shared_space') then
   -- Permanent/permission failures wait for explicit manager retry, not endless polling.
   update public.calendar_call_end_jobs set next_attempt_at='infinity'::timestamptz where occurrence_id=p_id;
   if v_reason='additional_authorization_required' then
    perform set_config('eba.google_import','on',true);
    update public.calendar_occurrences set call_end_status='reconnect_required' where id=p_id;
    perform set_config('eba.google_import',prior,true);
   end if;
  end if;
 end if;
 return result;
end $$;
revoke all on function public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb) to service_role;
-- Ordinary later title/provider synchronization must not requeue a completed end
-- and terminate a conference restarted through an old direct Google link.
-- AFTER triggers run by name: this follows calendar_call_end_plan.
create function public.calendar_preserve_call_end_history() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if new.status='scheduled' and new.joining_closed_at is not null
   and old.call_end_status in('ended','no_active_call') then
  update public.calendar_call_end_jobs set state=old.call_end_status,desired_version=new.version,
   lease=null,lease_until=null,next_attempt_at='infinity'::timestamptz where occurrence_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.calendar_preserve_call_end_history() from public,anon,authenticated;
create trigger calendar_call_end_terminal_history after update of version,starts_at,ends_at,status,join_url
 on public.calendar_occurrences for each row execute function public.calendar_preserve_call_end_history();
-- Existing overdue records remain historical. Queued requests are processed only by the worker.
notify pgrst,'reload schema';
commit;
