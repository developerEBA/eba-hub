-- Apply after Calendar Part 1 and Google organizer authorization. No Google calls.
begin;
alter table public.calendar_occurrences
  add column provider_conference_id text,
  add column meet_space_name text,
  add column recording_status text not null default 'pending' check (recording_status in ('pending','configured','warning','reconnect_required')),
  add column link_error_code text check (link_error_code in ('reconnect_required','permission_required','provider_unavailable','conference_failed','conflict','attendees_invalid','organizer_changed','setup_required'));
alter table public.calendar_occurrences add constraint calendar_google_join_url
  check (join_url is null or join_url ~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$') not valid;

create table public.calendar_sync_jobs (
  occurrence_id uuid primary key references public.calendar_occurrences(id) on delete cascade,
  desired_version integer not null,
  state text not null default 'pending' check (state in ('pending','processing','retry','blocked','failed','done')),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  lease_token uuid, lease_until timestamptz,
  conference_generation integer not null default 0,
  create_attempted boolean not null default false,
  cancel_settle_until timestamptz,
  error_code text,
  updated_at timestamptz not null default now()
);
create index calendar_sync_due on public.calendar_sync_jobs(next_attempt_at) where state<>'done';
alter table public.calendar_sync_jobs enable row level security;
revoke all on public.calendar_sync_jobs from public,anon,authenticated;
grant all on public.calendar_sync_jobs to service_role;

-- Never return private Google IDs, errors, lease data or credentials to browsers.
revoke select on public.calendar_occurrences from authenticated;
grant select(id,series_id,organizer_id,ordinal,original_starts_at,title,agenda,starts_at,ends_at,timezone,frequency,recurrence_until,attendee_ids,department_targets,status,version,join_url,sync_status,recording_status,link_error_code)
  on public.calendar_occurrences to authenticated;
revoke select on public.calendar_series from authenticated;
grant select(id,organizer_id,frequency,recurrence_until,timezone,cancelled_from,created_at) on public.calendar_series to authenticated;

create function public.calendar_enqueue_google() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_when='BEFORE' then
    if tg_op='INSERT' or new.version is distinct from old.version or new.status is distinct from old.status then
      new.link_error_code:=null;
      new.sync_status:=case when new.status='cancelled' then 'pending_cancel' when new.provider_event_id is null then 'pending_create' else 'pending_update' end;
    end if;
    return new;
  end if;
  if tg_op='INSERT' or new.version is distinct from old.version or new.status is distinct from old.status then
    insert into public.calendar_sync_jobs(occurrence_id,desired_version) values(new.id,new.version)
    on conflict(occurrence_id) do update set desired_version=excluded.desired_version,
      state=case when calendar_sync_jobs.lease_until>now() then 'processing' else 'pending' end,
      next_attempt_at=now(),attempts=0,error_code=null,updated_at=now();
  end if;
  return new;
end $$;
create trigger calendar_google_progress before insert or update of version,status on public.calendar_occurrences
  for each row execute function public.calendar_enqueue_google();
-- AFTER is required for the queue FK to see newly inserted occurrences.
create trigger calendar_queue_google after insert or update of version,status on public.calendar_occurrences
  for each row execute function public.calendar_enqueue_google();
revoke all on function public.calendar_enqueue_google() from public,anon,authenticated;

-- Claim, assert, bind-before-I/O, finish and retry all follow occurrence -> job
-- lock order. A newer edit retains an in-flight lease and queues its own version.
create function public.calendar_sync_control(p_action text,p_id uuid default null,p_lease uuid default null,p_version integer default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.calendar_occurrences; j public.calendar_sync_jobs; v_token uuid; v_state text;
begin
  if p_action='claim' then
    select c.* into o from public.calendar_occurrences c join public.calendar_sync_jobs q on q.occurrence_id=c.id
      where (p_id is null or c.id=p_id) and q.next_attempt_at<=now()
        and (q.state in ('pending','retry') or (q.state='processing' and q.lease_until<now()))
      order by case when c.status='cancelled' then 0 else 1 end,q.next_attempt_at,c.id
      for update of c,q skip locked limit 1;
    if not found then return null; end if;
    v_token:=gen_random_uuid();
    update public.calendar_sync_jobs set state='processing',lease_token=v_token,lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
      where occurrence_id=o.id returning * into j;
    return jsonb_build_object('meeting',to_jsonb(o),'job',to_jsonb(j));
  end if;
  select * into o from public.calendar_occurrences where id=p_id for update;
  if not found then return null; end if;
  select * into j from public.calendar_sync_jobs where occurrence_id=p_id for update;
  if not found then return null; end if;
  if p_action='retry' then
    if not exists(select 1 from public.staff_memberships where user_id=(p_data->>'actor')::uuid and status='active' and role in ('ceo','admin'))
      or o.organizer_id<>(p_data->>'actor')::uuid then raise exception 'Only the organizer can retry'; end if;
    update public.calendar_sync_jobs set
      conference_generation=conference_generation+case when error_code='conference_failed' then 1 else 0 end,
      state=case when lease_until>now() then 'processing' else 'pending' end,
      next_attempt_at=now(),attempts=0,error_code=null,updated_at=now() where occurrence_id=p_id;
    return '{}'::jsonb;
  end if;
  if j.state<>'processing' or p_lease is null or p_version is null or j.lease_until is null
    or j.lease_token is distinct from p_lease or j.lease_until<=now() then return null; end if;
  if o.version<>p_version or j.desired_version<>p_version then
    update public.calendar_sync_jobs set state='pending',next_attempt_at=now(),lease_token=null,lease_until=null where occurrence_id=p_id;
    return null;
  end if;
  if p_action='assert' then return to_jsonb(o); end if;
  if p_action='bind' then
    if o.provider_calendar_id is not null and o.provider_calendar_id<>p_data->>'email' then raise exception 'Organizer changed'; end if;
    if o.provider_event_id is not null and o.provider_event_id<>p_data->>'event_id' then raise exception 'Provider identity conflict'; end if;
    update public.calendar_occurrences set provider='google',provider_calendar_id=p_data->>'email',provider_event_id=p_data->>'event_id' where id=p_id;
    if (p_data->>'create_attempt')::boolean then
      update public.calendar_sync_jobs set create_attempted=true,cancel_settle_until=coalesce(cancel_settle_until,now()+interval '24 hours') where occurrence_id=p_id;
    end if;
    return '{}'::jsonb;
  end if;
  if p_action='finish' then
    v_state:=p_data->>'state';
    if v_state not in ('retry','blocked','failed','done') then raise exception 'Invalid sync outcome'; end if;
    update public.calendar_occurrences set
      sync_status=coalesce(p_data->>'sync_status',sync_status),
      join_url=case when o.status='cancelled' then null when p_data ? 'join_url' then p_data->>'join_url' else join_url end,
      provider_conference_id=coalesce(p_data->>'conference_id',provider_conference_id),
      provider_etag=coalesce(p_data->>'etag',provider_etag),
      meet_space_name=coalesce(p_data->>'space_name',meet_space_name),
      recording_status=coalesce(p_data->>'recording_status',recording_status),
      link_error_code=p_data->>'link_error_code',sync_error=p_data->>'error_code',
      synced_at=case when v_state='done' then now() else synced_at end where id=p_id;
    update public.calendar_sync_jobs set state=v_state,error_code=p_data->>'error_code',lease_token=null,lease_until=null,
      next_attempt_at=now()+make_interval(secs=>least(3600,greatest(15,coalesce((p_data->>'delay')::integer,30)))),updated_at=now()
      where occurrence_id=p_id;
    return '{}'::jsonb;
  end if;
  raise exception 'Unknown calendar sync action';
end $$;
revoke all on function public.calendar_sync_control(text,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_sync_control(text,uuid,uuid,integer,jsonb) to service_role;

create function public.calendar_google_people(p_ids uuid[]) returns table(user_id uuid,email text)
language sql stable security invoker set search_path='' as $$
  select u.id,u.email::text from auth.users u join public.staff_memberships m on m.user_id=u.id
  where u.id=any(p_ids) and m.status='active' and m.role in ('ceo','admin')
    and u.email_confirmed_at is not null and u.email ~* '^[^@]+@enibrand[.]com$'
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
$$;
revoke all on function public.calendar_google_people(uuid[]) from public,anon,authenticated;
grant execute on function public.calendar_google_people(uuid[]) to service_role;

create function public.calendar_wake_google_jobs() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.enabled and new.connected_at is distinct from old.connected_at then
    update public.calendar_sync_jobs set state='pending',next_attempt_at=now(),attempts=0
      where state='blocked' and error_code in ('reconnect_required','permission_required','setup_required');
  end if;
  return new;
end $$;
create trigger calendar_google_reconnected after update on public.google_organizer_connection
  for each row execute function public.calendar_wake_google_jobs();
revoke all on function public.calendar_wake_google_jobs() from public,anon,authenticated;

-- Existing scheduled, unfinished meetings are queued, not marked ready. No
-- provider calls occur until the operator enables/runs the worker or retries.
insert into public.calendar_sync_jobs(occurrence_id,desired_version)
  select id,version from public.calendar_occurrences where ends_at>now() and (status='scheduled' or provider_event_id is not null);
notify pgrst,'reload schema';
commit;
