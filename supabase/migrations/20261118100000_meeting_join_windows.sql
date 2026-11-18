-- Occurrence-level joining and durable Google call-ending requests. No live I/O.
begin;
alter table public.calendar_occurrences add column joining_closed_at timestamptz,
 add column call_end_status text not null default 'not_requested'
 check(call_end_status in('not_requested','pending','retry','ended','no_active_call','unavailable','shared_space'));
grant select(joining_closed_at,call_end_status) on public.calendar_occurrences to authenticated;
create table public.calendar_call_end_jobs (
 occurrence_id uuid primary key references public.calendar_occurrences(id) on delete cascade,
 desired_version integer not null,due_at timestamptz not null,next_attempt_at timestamptz not null,
 manual boolean not null default false,state text not null default 'pending',
 attempts integer not null default 0,lease uuid,lease_until timestamptz,
 space_name text,conference_record text,reason text,
 check(state in('pending','processing','retry','ended','no_active_call','unavailable','shared_space','cancelled'))
);
create index calendar_call_end_due on public.calendar_call_end_jobs(next_attempt_at) where state in('pending','retry','unavailable');
alter table public.calendar_call_end_jobs enable row level security;
revoke all on public.calendar_call_end_jobs from public,anon,authenticated;
grant all on public.calendar_call_end_jobs to service_role;
create table public.calendar_call_end_space_leases (
 join_key text primary key,occurrence_id uuid not null references public.calendar_occurrences(id) on delete cascade,
 token uuid not null,lease_until timestamptz not null
);
alter table public.calendar_call_end_space_leases enable row level security;
revoke all on public.calendar_call_end_space_leases from public,anon,authenticated;
grant all on public.calendar_call_end_space_leases to service_role;
create function public.calendar_plan_call_end() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new.version is not distinct from old.version and new.starts_at is not distinct from old.starts_at
   and new.ends_at is not distinct from old.ends_at and new.status is not distinct from old.status and new.join_url is not distinct from old.join_url then return new; end if;
 if new.status<>'scheduled' then
   update public.calendar_call_end_jobs set state='cancelled',lease=null,lease_until=null where occurrence_id=new.id;
   return new;
 end if;
 -- Newly discovered historical rows must not terminate an unrelated current call.
 if tg_op='INSERT' and new.ends_at+interval '3 hours'<=statement_timestamp() then return new; end if;
 insert into public.calendar_call_end_jobs(occurrence_id,desired_version,due_at,next_attempt_at,manual)
 values(new.id,new.version,case when new.joining_closed_at is not null then statement_timestamp() else new.ends_at+interval '3 hours' end,
 case when new.joining_closed_at is not null then statement_timestamp() else new.ends_at+interval '3 hours' end,new.joining_closed_at is not null)
 on conflict(occurrence_id) do update set desired_version=excluded.desired_version,due_at=excluded.due_at,next_attempt_at=excluded.next_attempt_at,
   manual=excluded.manual,state='pending',lease=null,lease_until=null,space_name=null,conference_record=null,reason=null;
 return new;
end $$;
revoke all on function public.calendar_plan_call_end() from public,anon,authenticated;
create trigger calendar_call_end_plan after insert or update of version,starts_at,ends_at,status,join_url on public.calendar_occurrences
 for each row execute function public.calendar_plan_call_end();
-- Block schedule/link edits while a short destructive call-end lease is in use.
-- This avoids rescheduling an occurrence after the final pre-I/O validation.
create function public.calendar_guard_call_end() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.version is distinct from old.version or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
   or new.status is distinct from old.status or new.join_url is distinct from old.join_url)
   and exists(select 1 from public.calendar_call_end_jobs where occurrence_id=old.id and state='processing' and lease_until>clock_timestamp())
 then raise exception 'Meeting call-ending check in progress; retry shortly'; end if;
 if new.joining_closed_at is null and (new.version is distinct from old.version or new.starts_at is distinct from old.starts_at
   or new.ends_at is distinct from old.ends_at or new.join_url is distinct from old.join_url) then
   new.call_end_status:='not_requested';
 end if;
 return new;
end $$;
revoke all on function public.calendar_guard_call_end() from public,anon,authenticated;
create trigger calendar_call_end_guard before update on public.calendar_occurrences for each row execute function public.calendar_guard_call_end();

create function public.calendar_call_end_control(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}')
 returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='1s' as $$
declare o public.calendar_occurrences;j public.calendar_call_end_jobs;v_now timestamptz:=clock_timestamp();v_lease uuid;
 previous_setting text:=coalesce(current_setting('eba.google_import',true),'');v_state text;
begin
 if p_action='claim' then
   select c.* into o from public.calendar_occurrences c join public.calendar_call_end_jobs q on q.occurrence_id=c.id
    where (p_id is null or c.id=p_id) and c.status='scheduled' and q.next_attempt_at<=v_now and q.desired_version=c.version
    and (q.state in('pending','retry','unavailable') or(q.state='processing' and q.lease_until<v_now))
    order by q.next_attempt_at,c.id limit 1 for update of c skip locked;
   if not found then return null; end if;
 else
   select * into o from public.calendar_occurrences where id=p_id for update;
   if not found then return null; end if;
 end if;
 if p_action='request' then
   if not public.calendar_reminder_account_active(p_actor) or not exists(select 1 from public.staff_memberships where user_id=p_actor and role='admin' and status='active')
    then raise exception 'Active Admin required'; end if;
   if o.status<>'scheduled' or v_now<o.starts_at then raise exception 'Occurrence joining window has not opened or is cancelled'; end if;
   if exists(select 1 from public.calendar_call_end_jobs where occurrence_id=o.id and state='processing' and lease_until>v_now) then return jsonb_build_object('pending',true); end if;
   perform set_config('eba.google_import','on',true);
   update public.calendar_occurrences set joining_closed_at=coalesce(joining_closed_at,v_now),call_end_status='pending' where id=o.id;
   perform set_config('eba.google_import',previous_setting,true);
   insert into public.calendar_call_end_jobs(occurrence_id,desired_version,due_at,next_attempt_at,manual)
    values(o.id,o.version,v_now,v_now,true) on conflict(occurrence_id) do update set manual=true,state='pending',due_at=v_now,next_attempt_at=v_now,lease=null,lease_until=null;
   return jsonb_build_object('pending',true);
 end if;
 select * into j from public.calendar_call_end_jobs where occurrence_id=o.id for update;
 if not found then return null; end if;
 if p_action='claim' then
   -- Recheck the latest job after acquiring locks; an earlier SELECT snapshot
   -- must never steal another worker's already-committed live lease.
   if j.desired_version<>o.version or j.next_attempt_at>clock_timestamp()
    or not(j.state in('pending','retry','unavailable') or(j.state='processing' and j.lease_until<clock_timestamp())) then return null; end if;
   v_lease:=gen_random_uuid();
   insert into public.calendar_call_end_space_leases(join_key,occurrence_id,token,lease_until)
    values(coalesce(o.join_url,'occurrence:'||o.id::text),o.id,v_lease,v_now+interval '30 seconds')
    on conflict(join_key) do update set occurrence_id=excluded.occurrence_id,token=excluded.token,lease_until=excluded.lease_until
     where calendar_call_end_space_leases.lease_until<clock_timestamp() returning token into v_lease;
   if not found then return null; end if;
   update public.calendar_call_end_jobs set state='processing',lease=v_lease,lease_until=v_now+interval '30 seconds',attempts=attempts+1
    where occurrence_id=o.id returning * into j;
   return jsonb_build_object('meeting',to_jsonb(o),'job',to_jsonb(j));
 end if;
 if j.state<>'processing' or j.lease is distinct from p_lease or j.lease_until<=v_now or j.desired_version<>o.version or o.status<>'scheduled'
  then return null; end if;
 if p_action in('assert','bind') then
   if not j.manual and v_now<o.ends_at+interval '3 hours' then return null; end if;
   if exists(select 1 from public.calendar_occurrences other where other.id<>o.id and other.status='scheduled' and other.join_url=o.join_url
     and other.joining_closed_at is null and other.starts_at<=v_now and other.ends_at+interval '3 hours'>v_now)
    then return jsonb_build_object('conflict',true); end if;
   if p_action='bind' then
     if j.conference_record is not null and j.conference_record is distinct from p_data->>'conference' then return null; end if;
     update public.calendar_call_end_jobs set space_name=p_data->>'space',conference_record=p_data->>'conference' where occurrence_id=o.id;
   end if;
   return jsonb_build_object('valid',true);
 end if;
 if p_action='finish' then
   v_state:=p_data->>'state';
   if v_state not in('ended','no_active_call','unavailable','shared_space','retry') then raise exception 'Invalid ending state'; end if;
   update public.calendar_call_end_jobs set state=v_state,reason=p_data->>'reason',lease=null,lease_until=null,
    next_attempt_at=v_now+case when v_state='unavailable' then interval '5 minutes' else interval '1 minute' end where occurrence_id=o.id;
   delete from public.calendar_call_end_space_leases where occurrence_id=o.id and token=p_lease;
   perform set_config('eba.google_import','on',true);
   update public.calendar_occurrences set call_end_status=v_state where id=o.id;
   perform set_config('eba.google_import',previous_setting,true);
   return jsonb_build_object('state',v_state);
 end if;
 return null;
end $$;
revoke all on function public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_call_end_control(text,uuid,uuid,uuid,jsonb) to service_role;
-- Future and currently extended occurrences only. No calls are ended here.
insert into public.calendar_call_end_jobs(occurrence_id,desired_version,due_at,next_attempt_at)
 select id,version,ends_at+interval '3 hours',ends_at+interval '3 hours' from public.calendar_occurrences
 where status='scheduled' and ends_at+interval '3 hours'>statement_timestamp();
notify pgrst,'reload schema';
commit;
