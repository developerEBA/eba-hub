begin;

-- Part 1 is deliberately provider-independent. No Google calls or reminder jobs
-- are dispatched by this migration. Apply manually after the read-only preflight.
create table public.staff_department_assignments (
  user_id uuid not null references public.staff_memberships(user_id) on delete cascade,
  department text not null check (department in ('graphics','development','communications','events','marketing')),
  primary key (user_id,department)
);
-- No assignments are fabricated from plan owners, chat rooms or job titles.
create table public.calendar_series (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.staff_memberships(user_id),
  frequency text not null check (frequency in ('once','weekly')),
  recurrence_until date,
  timezone text not null default 'Africa/Lagos' check (timezone='Africa/Lagos'),
  cancelled_from integer check (cancelled_from >= 0),
  provider text check (provider is null or provider='google'),
  provider_calendar_id text, provider_series_id text,
  created_at timestamptz not null default now(),
  unique (id,organizer_id),
  check ((frequency='weekly') = (recurrence_until is not null))
);
create table public.calendar_occurrences (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null,
  organizer_id uuid not null references public.staff_memberships(user_id),
  ordinal integer not null check (ordinal >= 0),
  original_starts_at timestamptz not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  agenda text check (length(agenda) <= 4000),
  starts_at timestamptz not null, ends_at timestamptz not null,
  timezone text not null default 'Africa/Lagos' check (timezone='Africa/Lagos'),
  frequency text not null check (frequency in ('once','weekly')),
  recurrence_until date,
  attendee_ids uuid[] not null default '{}', department_targets text[] not null default '{}',
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  cancellation_reason text check (cancellation_reason in ('organizer','series','series_shortened')),
  version integer not null default 1 check (version>0),
  provider text check (provider is null or provider='google'),
  provider_calendar_id text, provider_event_id text, provider_etag text,
  join_url text check (join_url is null or join_url ~ '^https://'),
  sync_status text not null default 'pending_setup' check (sync_status in ('pending_setup','pending_create','pending_update','pending_cancel','synced','error')),
  sync_error text, synced_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(series_id,organizer_id) references public.calendar_series(id,organizer_id) on delete cascade,
  unique(series_id,ordinal),
  check (ends_at>starts_at and ends_at<=starts_at+interval '24 hours'),
  check (cardinality(attendee_ids) between 1 and 100 and array_position(attendee_ids,null) is null),
  check (not (organizer_id=any(attendee_ids))),
  check (cardinality(department_targets)<=5 and department_targets <@ array['graphics','development','communications','events','marketing']::text[]),
  check ((frequency='weekly') = (recurrence_until is not null))
);
create index calendar_occurrences_organizer_time on public.calendar_occurrences(organizer_id,starts_at) where status='scheduled';
create index calendar_occurrences_attendees on public.calendar_occurrences using gin(attendee_ids);
create index calendar_occurrences_time on public.calendar_occurrences(starts_at,ends_at) where status='scheduled';
create unique index calendar_occurrences_provider_event on public.calendar_occurrences(provider,provider_calendar_id,provider_event_id) where provider_event_id is not null;
create table public.calendar_requests (
  actor_id uuid not null references public.staff_memberships(user_id), request_id uuid not null,
  request_hash text not null, occurrence_id uuid not null references public.calendar_occurrences(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
create table public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.calendar_occurrences(id) on delete cascade,
  user_id uuid not null references public.staff_memberships(user_id) on delete cascade,
  occurrence_version integer not null check (occurrence_version>0),
  lead_minutes integer not null check (lead_minutes between 0 and 10080),
  channel text not null default 'hub' check (channel in ('hub','email')),
  scheduled_for timestamptz,
  status text not null default 'pending_setup' check (status in ('pending_setup','scheduled','processing','needs_reschedule','cancelled','sent')),
  invalidated_at timestamptz, delivered_at timestamptz,
  unique(occurrence_id,user_id,lead_minutes,channel)
);
create index calendar_reminders_due on public.calendar_reminders(scheduled_for) where status='scheduled';

create function public.calendar_access() returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and status='active' and role in ('ceo','admin'))
    and coalesce((select auth.jwt())->>'email','') ~* '^[^@]+@enibrand[.]com$';
$$;
revoke all on function public.calendar_access() from public,anon,authenticated;
grant execute on function public.calendar_access() to authenticated,service_role;

alter table public.staff_department_assignments enable row level security;
alter table public.calendar_series enable row level security;
alter table public.calendar_occurrences enable row level security;
alter table public.calendar_requests enable row level security;
alter table public.calendar_reminders enable row level security;
revoke all on public.staff_department_assignments,public.calendar_series,public.calendar_occurrences,public.calendar_requests,public.calendar_reminders from public,anon,authenticated;
grant select on public.staff_department_assignments,public.calendar_series,public.calendar_occurrences to authenticated;
grant all on public.staff_department_assignments,public.calendar_series,public.calendar_occurrences,public.calendar_requests,public.calendar_reminders to service_role;
grant select on public.staff_memberships,public.connect_profiles to service_role;
create policy "Own staff department assignments" on public.staff_department_assignments for select to authenticated
  using ((select public.calendar_access()) and user_id=(select auth.uid()));
create policy "Organizer reads series metadata" on public.calendar_series for select to authenticated
  using ((select public.calendar_access()) and organizer_id=(select auth.uid()));
create policy "Only organizer and invited people read occurrences" on public.calendar_occurrences for select to authenticated
  using ((select public.calendar_access()) and (organizer_id=(select auth.uid()) or (select auth.uid())=any(attendee_ids)));
-- All browser writes and mutation RPC execution are revoked. Only the trusted
-- HTTP server calls this SECURITY INVOKER transaction after auth.getUser().
-- The transaction independently checks active membership, organizer, version,
-- selected attendees and real department assignments; service_role stays secret.
create function public.calendar_mutate(p_actor uuid,p_request uuid,p_command text,p_occurrence uuid,p_scope text,p_version integer,p_payload jsonb default '{}')
returns uuid language plpgsql security invoker set search_path='' set timezone='Africa/Lagos' as $$
declare
  r public.calendar_occurrences; s public.calendar_series; existing public.calendar_requests;
  v_title text; v_agenda text; v_start timestamptz; v_end timestamptz; v_until date;
  v_frequency text; v_attendees uuid[]; v_selected uuid[]; v_departments text[];
  v_hash text; v_id uuid; v_series uuid; v_base integer; v_count integer; i integer;
begin
  if current_user<>'service_role' then raise exception 'Server only'; end if;
  if not exists(select 1 from public.staff_memberships where user_id=p_actor and status='active' and role in ('ceo','admin')) then raise exception 'Active CEO or Admin required'; end if;
  if p_request is null or p_command is null or p_scope is null or p_command not in ('create','update','cancel') or p_scope not in ('one','remaining') then raise exception 'Invalid meeting command'; end if;
  v_hash:=md5(jsonb_build_object('command',p_command,'id',p_occurrence,'scope',p_scope,'version',p_version,'payload',p_payload)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,0));
  select * into existing from public.calendar_requests where actor_id=p_actor and request_id=p_request;
  if found then
    if existing.request_hash<>v_hash then raise exception 'Request ID was already used for another change'; end if;
    return existing.occurrence_id;
  end if;
  if p_command<>'create' then
    select * into r from public.calendar_occurrences where id=p_occurrence and organizer_id=p_actor;
    if not found then raise exception 'Meeting unavailable or you are not its organizer'; end if;
    select * into s from public.calendar_series where id=r.series_id for update;
    select * into r from public.calendar_occurrences where id=p_occurrence for update;
    if r.status<>'scheduled' or r.ends_at<=now() then raise exception 'This occurrence is cancelled or has ended'; end if;
    if p_version is null or r.version<>p_version then raise exception 'Meeting changed. Refresh before editing'; end if;
    v_id:=r.id; v_series:=s.id; v_base:=r.ordinal;
    if p_command='cancel' then
      if p_scope='remaining' then
        update public.calendar_series set cancelled_from=least(coalesce(cancelled_from,r.ordinal),r.ordinal) where id=s.id;
      end if;
      update public.calendar_occurrences set status='cancelled',cancellation_reason=case when p_scope='one' then 'organizer' else 'series' end,version=version+1,updated_at=now(),
        sync_status=case when provider_event_id is null then 'pending_setup' else 'pending_cancel' end
        where series_id=s.id and status='scheduled' and ends_at>now() and (id=r.id or (p_scope='remaining' and ordinal>=r.ordinal));
      insert into public.calendar_requests values(p_actor,p_request,v_hash,v_id,now());
      return v_id;
    end if;
  end if;

  v_title:=btrim(p_payload->>'title'); v_agenda:=nullif(btrim(p_payload->>'agenda'),'');
  v_start:=(p_payload->>'startsAt')::timestamptz; v_end:=(p_payload->>'endsAt')::timestamptz;
  v_frequency:=p_payload->>'frequency'; v_until:=(p_payload->>'until')::date;
  if v_title is null or length(v_title) not between 1 and 160 or length(v_agenda)>4000 or v_start is null or v_end is null
    or v_start<=now() or v_end<=v_start or v_end>v_start+interval '24 hours' then raise exception 'Invalid title, agenda or meeting times'; end if;
  if v_frequency is null or v_frequency not in ('once','weekly') then raise exception 'Choose a one-off or weekly meeting'; end if;
  if v_frequency='weekly' and (v_until is null or v_until<(v_start at time zone 'Africa/Lagos')::date or v_until>(v_start at time zone 'Africa/Lagos')::date+364) then raise exception 'Weekly end date must be within 52 weeks'; end if;
  if v_frequency='once' then v_until:=null; end if;
  select coalesce(array_agg(distinct value::uuid),'{}') into v_selected from jsonb_array_elements_text(coalesce(p_payload->'attendees','[]'));
  select coalesce(array_agg(distinct value),'{}') into v_departments from jsonb_array_elements_text(coalesce(p_payload->'departments','[]'));
  if cardinality(v_selected)>100 or cardinality(v_departments)>5 or not v_departments <@ array['graphics','development','communications','events','marketing']::text[] then raise exception 'Invalid attendee or department selection'; end if;
  if exists(select 1 from unnest(v_selected) x where not exists(select 1 from public.staff_memberships m where m.user_id=x and m.status='active' and m.role in ('ceo','admin'))) then raise exception 'Select only active CEOs and Admins'; end if;
  if exists(select 1 from unnest(v_departments) d where not exists(select 1 from public.staff_department_assignments a join public.staff_memberships m on m.user_id=a.user_id where a.department=d and m.status='active' and m.role in ('ceo','admin'))) then raise exception 'This department has no active staff assignments'; end if;
  select coalesce(array_agg(distinct person),'{}') into v_attendees from (
    select unnest(v_selected) as person union
    select a.user_id from public.staff_department_assignments a join public.staff_memberships m on m.user_id=a.user_id
      where a.department=any(v_departments) and m.status='active' and m.role in ('ceo','admin')
  ) people where person<>p_actor;
  if cardinality(v_attendees) not between 1 and 100 then raise exception 'Select between 1 and 100 other active attendees'; end if;

  if p_command='create' then
    v_series:=p_request; v_base:=0;
    insert into public.calendar_series(id,organizer_id,frequency,recurrence_until) values(v_series,p_actor,v_frequency,v_until);
  elsif p_scope='one' or s.frequency='once' then
    update public.calendar_occurrences set title=v_title,agenda=v_agenda,starts_at=v_start,ends_at=v_end,attendee_ids=v_attendees,department_targets=v_departments,
      version=version+1,updated_at=now(),sync_status=case when provider_event_id is null then 'pending_setup' else 'pending_update' end where id=r.id;
    insert into public.calendar_requests values(p_actor,p_request,v_hash,v_id,now()); return v_id;
  else
    if v_frequency<>s.frequency then raise exception 'Keep the series recurrence type; create a new meeting to change it'; end if;
    update public.calendar_series set recurrence_until=v_until where id=s.id;
  end if;
  v_count:=case when v_frequency='weekly' then ((v_until-(v_start at time zone 'Africa/Lagos')::date)/7)+1 else 1 end;
  for i in 0..v_count-1 loop
    if p_command='update' and s.cancelled_from is not null and v_base+i>=s.cancelled_from then continue; end if;
    insert into public.calendar_occurrences(series_id,organizer_id,ordinal,original_starts_at,title,agenda,starts_at,ends_at,frequency,recurrence_until,attendee_ids,department_targets)
      values(v_series,p_actor,v_base+i,v_start+i*interval '7 days',v_title,v_agenda,v_start+i*interval '7 days',v_end+i*interval '7 days',v_frequency,v_until,v_attendees,v_departments)
    on conflict(series_id,ordinal) do update set title=excluded.title,agenda=excluded.agenda,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
      attendee_ids=excluded.attendee_ids,department_targets=excluded.department_targets,recurrence_until=excluded.recurrence_until,status='scheduled',cancellation_reason=null,
      version=calendar_occurrences.version+1,updated_at=now(),sync_status=case when calendar_occurrences.provider_event_id is null then 'pending_setup' else 'pending_update' end
      where calendar_occurrences.ends_at>now() and (calendar_occurrences.status='scheduled' or calendar_occurrences.cancellation_reason='series_shortened');
  end loop;
  if p_command='update' then
    update public.calendar_occurrences set status='cancelled',cancellation_reason='series_shortened',version=version+1,updated_at=now(),
      sync_status=case when provider_event_id is null then 'pending_setup' else 'pending_cancel' end
      where series_id=v_series and ordinal>=v_base+v_count and ends_at>now() and status='scheduled';
  end if;
  select id into v_id from public.calendar_occurrences where series_id=v_series and ordinal=v_base;
  insert into public.calendar_requests values(p_actor,p_request,v_hash,v_id,now()); return v_id;
end $$;
revoke all on function public.calendar_mutate(uuid,uuid,text,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_mutate(uuid,uuid,text,uuid,text,integer,jsonb) to service_role;

create function public.calendar_invalidate_reminders() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.version is distinct from old.version or new.status is distinct from old.status or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at or new.attendee_ids is distinct from old.attendee_ids then
    update public.calendar_reminders set
      status=case when new.status='cancelled' or (user_id<>new.organizer_id and not user_id=any(new.attendee_ids)) then 'cancelled' else 'needs_reschedule' end,
      occurrence_version=new.version,scheduled_for=null,invalidated_at=now()
      where occurrence_id=new.id and status<>'sent';
  end if;
  return new;
end $$;
revoke all on function public.calendar_invalidate_reminders() from public,anon,authenticated;
grant execute on function public.calendar_invalidate_reminders() to service_role;
create trigger calendar_occurrence_reminders after update on public.calendar_occurrences for each row execute function public.calendar_invalidate_reminders();
comment on table public.calendar_reminders is 'Part 2 must re-read occurrence status, recipient eligibility and version immediately before dispatch; never deliver stale claimed jobs. No jobs are created in Part 1.';
notify pgrst,'reload schema';
commit;
