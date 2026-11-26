-- Required meeting participation for active verified CEO/Admin accounts and
-- the currently assigned Communications HOD. Forward-only; no live reminders,
-- Google requests or existing-meeting audience changes run in this migration.
begin;

do $$ begin
  if to_regclass('public.calendar_occurrences') is null
    or to_regclass('public.calendar_series') is null
    or to_regclass('public.calendar_requests') is null
    or to_regclass('public.calendar_sync_jobs') is null
    or to_regclass('public.calendar_reminders') is null
    or to_regclass('public.staff_memberships') is null
    or to_regclass('public.staff_department_assignments') is null
    or to_regclass('auth.users') is null then
    raise exception 'Calendar, membership and verified-account prerequisites are missing';
  end if;
end $$;

create table public.calendar_occurrence_participant_sources (
  occurrence_id uuid not null references public.calendar_occurrences(id) on delete cascade,
  -- Keep participation history when a membership is removed so its mandatory
  -- audience can be revoked. Auth-user deletion still removes the row.
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in (
    'explicit_invite','department_invite','google_invitation','legacy_unclassified',
    'required_ceo','required_admin','required_communications_hod','revoked_required'
  )),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (occurrence_id,user_id,source)
);
create index calendar_participant_sources_user on public.calendar_occurrence_participant_sources(user_id,occurrence_id);
alter table public.calendar_occurrence_participant_sources enable row level security;
revoke all on public.calendar_occurrence_participant_sources from public,anon,authenticated;
grant all on public.calendar_occurrence_participant_sources to service_role;

-- Existing attendee arrays do not say why a person was included. Preserve
-- that ambiguity instead of pretending that past guests were explicit or
-- mandatory. This source keeps historical access when mandatory status ends.
insert into public.calendar_occurrence_participant_sources(occurrence_id,user_id,source)
select o.id,p.user_id,'legacy_unclassified'
from public.calendar_occurrences o
cross join lateral unnest(o.attendee_ids) as p(user_id)
on conflict do nothing;

-- Last observed Google attendee sets let later imports distinguish an
-- organizer's new invitation from a mandatory guest EBA itself just added.
create table public.calendar_google_attendee_snapshots (
  occurrence_id uuid primary key references public.calendar_occurrences(id) on delete cascade,
  attendee_ids uuid[] not null default '{}',
  observed_at timestamptz not null default clock_timestamp()
);
alter table public.calendar_google_attendee_snapshots enable row level security;
revoke all on public.calendar_google_attendee_snapshots from public,anon,authenticated;
grant all on public.calendar_google_attendee_snapshots to service_role;

create function eba_private.calendar_required_source(p_user uuid)
returns text language sql stable security definer set search_path=''
as $$
  select case
    when m.role='ceo' then 'required_ceo'
    when m.role='admin' then 'required_admin'
    when m.role='hod' and exists(select 1 from public.staff_department_assignments a
      where a.user_id=m.user_id and a.department='communications') then 'required_communications_hod'
  end
  from public.staff_memberships m join auth.users u on u.id=m.user_id
  where m.user_id=p_user and m.status='active'
    and m.role in('ceo','admin','hod')
    and u.email ~* '^[^@]+@enibrand[.]com$' and u.email_confirmed_at is not null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp());
$$;
revoke all on function eba_private.calendar_required_source(uuid) from public,anon,authenticated;
grant execute on function eba_private.calendar_required_source(uuid) to service_role;

-- Calendar RLS uses a no-argument helper so it can recheck the current auth
-- account without exposing eligibility lookups for arbitrary user IDs.
create function eba_private.calendar_current_member()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(eba_private.calendar_required_source(auth.uid()) is not null
    or eba_private.hod_dashboard_member(auth.uid()),false);
$$;
revoke all on function eba_private.calendar_current_member() from public,anon,authenticated;
grant execute on function eba_private.calendar_current_member() to authenticated,service_role;

create or replace function public.calendar_access() returns boolean
language sql stable security invoker set search_path='' as $$
  select eba_private.calendar_current_member();
$$;
revoke all on function public.calendar_access() from public,anon,authenticated;
grant execute on function public.calendar_access() to authenticated,service_role;

create function public.calendar_required_participant_emails()
returns text[] language sql stable security invoker set search_path=''
as $$
  select coalesce(array_agg(u.email::text order by lower(u.email)),array[]::text[])
  from auth.users u join public.staff_memberships m on m.user_id=u.id
  where eba_private.calendar_required_source(u.id) is not null;
$$;
revoke all on function public.calendar_required_participant_emails() from public,anon,authenticated;
grant execute on function public.calendar_required_participant_emails() to service_role;

create function public.calendar_google_invitation_deltas(p_calendar_id text,p_event_ids text[])
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(o.provider_event_id,jsonb_build_object('remove_emails',coalesce(x.emails,'[]'::jsonb))),'{}'::jsonb)
  from public.calendar_occurrences o
  left join lateral (
    select jsonb_agg(u.email::text order by lower(u.email)) as emails
    from public.calendar_occurrence_participant_sources s join auth.users u on u.id=s.user_id
    where s.occurrence_id=o.id and s.source='revoked_required'
      and eba_private.calendar_required_source(s.user_id) is null
      and exists(select 1 from public.calendar_google_attendee_snapshots snap
        where snap.occurrence_id=o.id and s.user_id=any(snap.attendee_ids))
      and not exists(select 1 from public.calendar_occurrence_participant_sources independent
        where independent.occurrence_id=o.id and independent.user_id=s.user_id
          and independent.source in('google_invitation','legacy_unclassified','explicit_invite','department_invite'))
      and u.email ~* '^[^@]+@enibrand[.]com$'
  ) x on true
  where o.source='google' and o.provider_calendar_id=p_calendar_id and o.provider_event_id=any(coalesce(p_event_ids,'{}'::text[]));
$$;
revoke all on function public.calendar_google_invitation_deltas(text,text[]) from public,anon,authenticated;
grant execute on function public.calendar_google_invitation_deltas(text,text[]) to service_role;

create function public.calendar_enforce_required_participants()
returns trigger language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; legacy uuid[]; requested uuid[]:='{}'::uuid[];
begin
  if new.status='scheduled' and new.ends_at>statement_timestamp() then
    -- Keep historical attendees whose provenance cannot be determined, even
    -- if a later edit omits them. Only future edits with recorded provenance
    -- can distinguish removable mandatory-only attendees from other guests.
    if tg_op='UPDATE' then
      select coalesce(array_agg(distinct s.user_id order by s.user_id),'{}'::uuid[]) into legacy
      from public.calendar_occurrence_participant_sources s
      where s.occurrence_id=old.id and s.source in('legacy_unclassified','google_invitation')
        and not(coalesce(current_setting('eba.google_import',true),'')='on' and s.source='google_invitation');
    else legacy:='{}'::uuid[]; end if;

    begin
      select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into requested
      from jsonb_array_elements_text(coalesce(nullif(current_setting('eba.requested_explicit',true),'')::jsonb,'[]'::jsonb)) as items(value);
    exception when others then requested:='{}'::uuid[];
    end;

    if coalesce(current_setting('eba.google_import',true),'')='on' then
      perform set_config('eba.google_original_attendees',to_jsonb(coalesce(new.attendee_ids,'{}'::uuid[]))::text,true);
    end if;

    select coalesce(array_agg(distinct candidate.user_id order by candidate.user_id),'{}'::uuid[]) into ids
    from (
      select x.user_id
      from unnest(coalesce(new.attendee_ids,'{}'::uuid[])||coalesce(legacy,'{}'::uuid[])) x(user_id)
      where x.user_id<>new.organizer_id and not (
        tg_op='UPDATE'
        and exists(select 1 from public.calendar_occurrence_participant_sources s
          where s.occurrence_id=old.id and s.user_id=x.user_id
            and s.source in('required_ceo','required_admin','required_communications_hod'))
        and eba_private.calendar_required_source(x.user_id) is null
        and not exists(select 1 from public.calendar_occurrence_participant_sources s
          where s.occurrence_id=old.id and s.user_id=x.user_id
            and s.source in('explicit_invite','department_invite','google_invitation','legacy_unclassified'))
        and exists(select 1 from public.calendar_occurrence_participant_sources s
          where s.occurrence_id=old.id and s.user_id=x.user_id and s.source='revoked_required')
        and not x.user_id=any(requested)
        and not exists(select 1 from public.staff_department_assignments a join public.staff_memberships m on m.user_id=a.user_id
          where a.user_id=x.user_id and a.department=any(new.department_targets)
            and m.status='active' and m.role in('ceo','admin','hod'))
      )
      union
      select m.user_id from public.staff_memberships m join auth.users u on u.id=m.user_id
      where m.status='active' and m.role in('ceo','admin','hod') and m.user_id<>new.organizer_id
        and eba_private.calendar_required_source(m.user_id) is not null
    ) candidate;
    if cardinality(ids)>100 then raise exception 'Required participants would exceed the 100-attendee limit'; end if;
    new.attendee_ids:=ids;
  end if;
  return new;
end $$;
create trigger calendar_required_participants_before
before insert or update of attendee_ids,status,ends_at on public.calendar_occurrences
for each row execute function public.calendar_enforce_required_participants();
revoke all on function public.calendar_enforce_required_participants() from public,anon,authenticated;

create function public.calendar_record_participant_sources()
returns trigger language plpgsql security invoker set search_path='' as $$
declare original_json text; original_ids uuid[]; imported uuid[];
begin
  if new.status<>'scheduled' or new.ends_at<=statement_timestamp() then return new; end if;

  delete from public.calendar_occurrence_participant_sources s
  where s.occurrence_id=new.id and s.source in('required_ceo','required_admin','required_communications_hod')
    and eba_private.calendar_required_source(s.user_id) is null;

  insert into public.calendar_occurrence_participant_sources(occurrence_id,user_id,source)
  select new.id,p.user_id,eba_private.calendar_required_source(p.user_id)
  from unnest(new.attendee_ids) p(user_id)
  where eba_private.calendar_required_source(p.user_id) is not null
  on conflict do nothing;
  delete from public.calendar_occurrence_participant_sources s
    where s.occurrence_id=new.id and s.source='revoked_required'
      and eba_private.calendar_required_source(s.user_id) is not null;

  if new.source='google' and coalesce(current_setting('eba.google_import',true),'')='on' then
    original_json:=coalesce(current_setting('eba.google_original_attendees',true),'[]');
    begin
      select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into original_ids
      from jsonb_array_elements_text(original_json::jsonb) as items(value);
    exception when others then original_ids:='{}'::uuid[];
    end;
    delete from public.calendar_occurrence_participant_sources s
      where s.occurrence_id=new.id and s.source='google_invitation'
        and not(s.user_id=any(original_ids));
    original_json:=coalesce(current_setting('eba.google_preexisting_invites',true),'{}');
    begin
      select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into imported
      from jsonb_array_elements_text(coalesce((original_json::jsonb)->new.provider_event_id,'[]'::jsonb)) as ids(value);
    exception when others then imported:='{}'::uuid[];
    end;
    insert into public.calendar_occurrence_participant_sources(occurrence_id,user_id,source)
      select new.id,p.user_id,'google_invitation' from unnest(imported) p(user_id)
      where p.user_id<>new.organizer_id and p.user_id=any(original_ids)
        and not exists(select 1 from public.calendar_occurrence_participant_sources s
          where s.occurrence_id=new.id and s.user_id=p.user_id and s.source='revoked_required')
      on conflict do nothing;
    delete from public.calendar_occurrence_participant_sources s where s.occurrence_id=new.id
      and s.source='revoked_required' and not(s.user_id=any(original_ids));
  end if;
  return new;
end $$;
create trigger calendar_required_participants_after
after insert or update of attendee_ids,status,ends_at on public.calendar_occurrences
for each row execute function public.calendar_record_participant_sources();
revoke all on function public.calendar_record_participant_sources() from public,anon,authenticated;

-- Preserve the Google-invited audience that existed before the integration
-- added required participants. This lets later reconciliation distinguish an
-- independent Google invitation from a required-only guest without guessing.
alter function public.calendar_google_import(text,text,jsonb) rename to calendar_google_import_v1;
revoke all on function public.calendar_google_import_v1(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_google_import_v1(text,text,jsonb) to service_role;
create function public.calendar_google_import(p_action text,p_email text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare invite_map jsonb:='{}'::jsonb; prior text:=coalesce(current_setting('eba.google_preexisting_invites',true),''); result jsonb;
  event_data jsonb; occurrence uuid; previous_ids uuid[]; current_ids uuid[]; preexisting_ids uuid[]; had_snapshot boolean;
begin
  if current_user<>'service_role' then raise exception 'Server only'; end if;
  if p_action='finish' and jsonb_typeof(p_data->'events')='array' then
    select coalesce(jsonb_object_agg(e.value->>'id',to_jsonb(coalesce(ids.user_ids,'{}'::uuid[]))),'{}'::jsonb)
      into invite_map
    from jsonb_array_elements(p_data->'events') e(value)
    left join lateral (
      select array_agg(distinct u.id order by u.id) as user_ids
      from jsonb_array_elements_text(coalesce(e.value->'preexisting_attendees','[]'::jsonb)) email(value)
      join auth.users u on lower(u.email)=lower(email.value)
      where public.calendar_reminder_account_active(u.id)
        and not exists(select 1 from public.calendar_occurrences o
          join public.calendar_occurrence_participant_sources s on s.occurrence_id=o.id and s.user_id=u.id
          where o.source='google' and o.provider_calendar_id=p_email and o.provider_event_id=e.value->>'id'
            and s.source in('required_ceo','required_admin','required_communications_hod'))
    ) ids on true
    where nullif(e.value->>'id','') is not null;
  end if;
  perform set_config('eba.google_preexisting_invites',invite_map::text,true);
  result:=public.calendar_google_import_v1(p_action,p_email,p_data);
  perform set_config('eba.google_preexisting_invites',prior,true);
  if p_action='finish' and jsonb_typeof(p_data->'events')='array' then
    for event_data in select value from jsonb_array_elements(p_data->'events') as events(value)
    loop
      if coalesce((event_data->>'cancelled')::boolean,false) or jsonb_typeof(event_data->'attendees')<>'array' then continue; end if;
      select o.id into occurrence from public.calendar_occurrences o
        where o.source='google' and o.provider_calendar_id=p_email and o.provider_event_id=event_data->>'id';
      if not found then continue; end if;
      select s.attendee_ids into previous_ids from public.calendar_google_attendee_snapshots s where s.occurrence_id=occurrence;
      had_snapshot:=found;
      if not had_snapshot then previous_ids:='{}'::uuid[]; end if;
      select coalesce(array_agg(distinct u.id order by u.id),'{}'::uuid[]) into current_ids
        from jsonb_array_elements_text(coalesce(event_data->'attendees','[]'::jsonb)) attendee(email)
        join auth.users u on lower(u.email)=lower(attendee.email)
        where public.calendar_reminder_account_active(u.id);
      select coalesce(array_agg(distinct u.id order by u.id),'{}'::uuid[]) into preexisting_ids
        from jsonb_array_elements_text(coalesce(event_data->'preexisting_attendees','[]'::jsonb)) attendee(email)
        join auth.users u on lower(u.email)=lower(attendee.email)
        where public.calendar_reminder_account_active(u.id);
      -- A person who reappears after a previously observed removal is an
      -- independent Google invitation. Clear the stale mandatory revocation
      -- before recording that provenance so later syncs do not remove them.
      delete from public.calendar_occurrence_participant_sources s where s.occurrence_id=occurrence
        and s.source='revoked_required' and s.user_id=any(preexisting_ids)
        and not s.user_id=any(previous_ids) and s.user_id=any(current_ids);
      insert into public.calendar_occurrence_participant_sources(occurrence_id,user_id,source)
        select occurrence,p.user_id,'google_invitation' from unnest(preexisting_ids) p(user_id)
        where p.user_id=any(current_ids) and (not had_snapshot or not p.user_id=any(previous_ids))
        on conflict do nothing;
      delete from public.calendar_occurrence_participant_sources s where s.occurrence_id=occurrence
        and s.source='google_invitation' and not s.user_id=any(current_ids);
      insert into public.calendar_google_attendee_snapshots(occurrence_id,attendee_ids,observed_at)
        values(occurrence,current_ids,clock_timestamp())
        on conflict(occurrence_id) do update set attendee_ids=excluded.attendee_ids,observed_at=excluded.observed_at;
      delete from public.calendar_occurrence_participant_sources s where s.occurrence_id=occurrence
        and s.source='revoked_required' and not s.user_id=any(current_ids);
    end loop;
  end if;
  return result;
end $$;
revoke all on function public.calendar_google_import(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_google_import(text,text,jsonb) to service_role;

-- Preserve the existing mutation validation, locks and idempotency function.
-- The service-only wrapper records intent and the BEFORE trigger adds mandatory
-- users even when a server caller supplies a manipulated attendee array.
alter function public.calendar_mutate(uuid,uuid,text,uuid,text,integer,jsonb) rename to calendar_mutate_v1;
revoke all on function public.calendar_mutate_v1(uuid,uuid,text,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_mutate_v1(uuid,uuid,text,uuid,text,integer,jsonb) to service_role;

create function public.calendar_record_mutation_sources(p_occurrence uuid,p_explicit uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare o public.calendar_occurrences; current_ids uuid[];
begin
  select * into o from public.calendar_occurrences where id=p_occurrence;
  if not found then return; end if;
  delete from public.calendar_occurrence_participant_sources
   where occurrence_id=o.id and source in('explicit_invite','department_invite');
  insert into public.calendar_occurrence_participant_sources(occurrence_id,user_id,source)
    select o.id,p.user_id,'explicit_invite' from unnest(coalesce(p_explicit,'{}'::uuid[])) p(user_id)
    where p.user_id<>o.organizer_id
    on conflict do nothing;
  insert into public.calendar_occurrence_participant_sources(occurrence_id,user_id,source)
    select o.id,a.user_id,'department_invite'
    from public.staff_department_assignments a join public.staff_memberships m on m.user_id=a.user_id
    where a.department=any(o.department_targets) and m.status='active'
      and m.role in('ceo','admin','hod') and public.calendar_reminder_account_active(a.user_id)
      and a.user_id<>o.organizer_id
    on conflict do nothing;
  delete from public.calendar_occurrence_participant_sources s where s.occurrence_id=o.id and s.source='revoked_required'
    and exists(select 1 from public.calendar_occurrence_participant_sources keep where keep.occurrence_id=o.id
      and keep.user_id=s.user_id and keep.source in('explicit_invite','department_invite'));
  select coalesce(array_agg(distinct s.user_id order by s.user_id),'{}'::uuid[]) into current_ids
    from public.calendar_occurrence_participant_sources s where s.occurrence_id=o.id and s.user_id<>o.organizer_id
      and s.source<>'revoked_required';
  if current_ids is distinct from o.attendee_ids then
    update public.calendar_occurrences set attendee_ids=current_ids,version=version+1,updated_at=clock_timestamp() where id=o.id;
  end if;
end $$;
revoke all on function public.calendar_record_mutation_sources(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.calendar_record_mutation_sources(uuid,uuid[]) to service_role;

create function public.calendar_mutate(p_actor uuid,p_request uuid,p_command text,p_occurrence uuid,p_scope text,p_version integer,p_payload jsonb default '{}')
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; base_row public.calendar_occurrences; o public.calendar_occurrences; target record;
  v_explicit uuid[]; v_executives uuid[]; v_fallback uuid; v_payload jsonb;
  existing_request public.calendar_requests; wrapped_hash text; legacy_hash text;
  previous text:=coalesce(current_setting('eba.calendar_required_wrapper',true),'');
  prior_explicit text:=coalesce(current_setting('eba.requested_explicit',true),'');
begin
  if current_user<>'service_role' then raise exception 'Server only'; end if;
  if not coalesce(eba_private.calendar_required_source(p_actor) in('required_ceo','required_admin'),false) then
    raise exception 'An active verified CEO or Admin account is required';
  end if;
  if p_command in('create','update') then
    select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_explicit
      from jsonb_array_elements_text(coalesce(p_payload->'attendees','[]')) as ids(value);
    select coalesce(array_agg(distinct selected.user_id order by selected.user_id),'{}'::uuid[]) into v_executives
      from unnest(v_explicit) selected(user_id) join public.staff_memberships m on m.user_id=selected.user_id
      where m.status='active' and m.role in('ceo','admin') and selected.user_id<>p_actor;
    if cardinality(v_executives)=0 then
      select m.user_id into v_fallback from public.staff_memberships m
        where m.user_id<>p_actor and m.status='active' and m.role in('ceo','admin')
          and eba_private.calendar_required_source(m.user_id) in('required_ceo','required_admin')
        order by m.role,m.user_id limit 1;
      if v_fallback is not null then v_executives:=array[v_fallback]; end if;
    end if;
    -- The preserved RPC accepts executive selections only. The marker keeps
    -- the original HOD selection in its request hash; the wrapper records the
    -- complete attendee list after the old validations, lock and idempotency.
    v_payload:=coalesce(p_payload,'{}'::jsonb)
      ||jsonb_build_object('attendees',to_jsonb(v_executives),'eba_explicit_attendees',to_jsonb(v_explicit));
    if p_request is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,0));
      select * into existing_request from public.calendar_requests
        where actor_id=p_actor and request_id=p_request;
      if found then
        wrapped_hash:=md5(jsonb_build_object('command',p_command,'id',p_occurrence,'scope',p_scope,
          'version',p_version,'payload',v_payload)::text);
        legacy_hash:=md5(jsonb_build_object('command',p_command,'id',p_occurrence,'scope',p_scope,
          'version',p_version,'payload',coalesce(p_payload,'{}'::jsonb))::text);
        if existing_request.request_hash not in(wrapped_hash,legacy_hash) then
          raise exception 'Request ID was already used for another change';
        end if;
        return existing_request.occurrence_id;
      end if;
    end if;
    if exists(select 1 from unnest(v_explicit) selected(user_id)
      where not exists(select 1 from public.staff_memberships m where m.user_id=selected.user_id
        and m.status='active' and m.role in('ceo','admin','hod')
        and public.calendar_reminder_account_active(m.user_id))) then
      raise exception 'Select only active eligible CEO, Admin or assigned HOD attendees';
    end if;
    if cardinality(v_executives)=0 then
      raise exception 'An additional active CEO or Admin is required to schedule this meeting';
    end if;
  else v_explicit:='{}'::uuid[]; end if;
  perform set_config('eba.calendar_required_wrapper','on',true);
  perform set_config('eba.requested_explicit',to_jsonb(v_explicit)::text,true);
  v_id:=public.calendar_mutate_v1(p_actor,p_request,p_command,p_occurrence,p_scope,p_version,coalesce(v_payload,p_payload));
  perform set_config('eba.requested_explicit',prior_explicit,true);
  if p_command in('create','update') then
    select * into base_row from public.calendar_occurrences where id=v_id;
    if found then
      for target in select id from public.calendar_occurrences
        where series_id=base_row.series_id and status='scheduled' and ends_at>statement_timestamp()
          and (id=base_row.id or (p_scope='remaining' and ordinal>=base_row.ordinal))
        order by ordinal
      loop perform public.calendar_record_mutation_sources(target.id,v_explicit); end loop;
    end if;
  end if;
  perform set_config('eba.calendar_required_wrapper',previous,true);
  return v_id;
end $$;
revoke all on function public.calendar_mutate(uuid,uuid,text,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_mutate(uuid,uuid,text,uuid,text,integer,jsonb) to service_role;

alter function public.calendar_hod_create(uuid,uuid,jsonb) rename to calendar_hod_create_v1;
revoke all on function public.calendar_hod_create_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_hod_create_v1(uuid,uuid,jsonb) to service_role;
create function public.calendar_hod_create(p_actor uuid,p_request uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; base_row public.calendar_occurrences; target record; v_explicit uuid[];
  prior_explicit text:=coalesce(current_setting('eba.requested_explicit',true),'');
begin
  if current_user<>'service_role' then raise exception 'Server only'; end if;
  select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_explicit
    from jsonb_array_elements_text(coalesce(p_payload->'attendees','[]')) as ids(value);
  perform set_config('eba.requested_explicit',coalesce(p_payload->'attendees','[]'::jsonb)::text,true);
  v_id:=public.calendar_hod_create_v1(p_actor,p_request,p_payload);
  perform set_config('eba.requested_explicit',prior_explicit,true);
  select * into base_row from public.calendar_occurrences where id=v_id;
  if found then
    for target in select id from public.calendar_occurrences
      where series_id=base_row.series_id and status='scheduled' and ends_at>statement_timestamp()
      order by ordinal
    loop perform public.calendar_record_mutation_sources(target.id,v_explicit); end loop;
  end if;
  return v_id;
end $$;
revoke all on function public.calendar_hod_create(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_hod_create(uuid,uuid,jsonb) to service_role;

-- Rebuild only from known invitation provenance plus the current mandatory
-- set. Legacy-unclassified recipients are retained because their reason is
-- unknowable. Updating attendee_ids invokes existing version, reminder and
-- durable Google sync triggers; no job is processed here.
create function eba_private.calendar_reconcile_occurrence(p_occurrence uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.calendar_occurrences; next_ids uuid[]; current_ids uuid[];
begin
  select * into o from public.calendar_occurrences where id=p_occurrence for update;
  if not found or o.status<>'scheduled' or o.ends_at<=statement_timestamp() then return false; end if;
  -- Department-based invitations remain valid only while the person has an
  -- active eligible assignment to one of the occurrence's target departments.
  -- Explicit/Google/legacy invitations are tracked separately and preserved.
  delete from public.calendar_occurrence_participant_sources s
    where s.occurrence_id=o.id and s.source='department_invite'
      and not exists(select 1 from public.staff_department_assignments a
        where a.user_id=s.user_id and a.department=any(o.department_targets)
          and public.calendar_reminder_account_active(a.user_id));
  insert into public.calendar_occurrence_participant_sources(occurrence_id,user_id,source)
    select o.id,s.user_id,'revoked_required'
    from public.calendar_occurrence_participant_sources s
    where s.occurrence_id=o.id and s.source in('required_ceo','required_admin','required_communications_hod')
      and eba_private.calendar_required_source(s.user_id) is null
      and not exists(select 1 from public.calendar_occurrence_participant_sources keep
        where keep.occurrence_id=o.id and keep.user_id=s.user_id
          and keep.source in('explicit_invite','department_invite','google_invitation','legacy_unclassified'))
    on conflict do nothing;
  delete from public.calendar_occurrence_participant_sources s
    where s.occurrence_id=o.id and s.source in('required_ceo','required_admin','required_communications_hod')
      and eba_private.calendar_required_source(s.user_id) is null;
  insert into public.calendar_occurrence_participant_sources(occurrence_id,user_id,source)
    select o.id,m.user_id,eba_private.calendar_required_source(m.user_id)
    from public.staff_memberships m join auth.users u on u.id=m.user_id
    where m.status='active' and m.role in('ceo','admin','hod') and m.user_id<>o.organizer_id
      and eba_private.calendar_required_source(m.user_id) is not null
    on conflict do nothing;
  delete from public.calendar_occurrence_participant_sources s where s.occurrence_id=o.id and s.source='revoked_required'
    and eba_private.calendar_required_source(s.user_id) is not null;
  select coalesce(array_agg(distinct s.user_id order by s.user_id),'{}'::uuid[]) into next_ids
    from public.calendar_occurrence_participant_sources s
    where s.occurrence_id=o.id and s.user_id<>o.organizer_id and s.source<>'revoked_required';
  current_ids:=o.attendee_ids;
  if cardinality(next_ids)>100 then raise exception 'Required participants would exceed the 100-attendee limit for occurrence %',o.id; end if;
  if current_ids is distinct from next_ids then
    update public.calendar_occurrences set attendee_ids=next_ids,
      version=version+case when o.source is distinct from 'google' then 1 else 0 end,
      updated_at=clock_timestamp()
      where id=o.id;
    return true;
  end if;
  return false;
end $$;
revoke all on function eba_private.calendar_reconcile_occurrence(uuid) from public,anon,authenticated;
grant execute on function eba_private.calendar_reconcile_occurrence(uuid) to service_role;

create function eba_private.calendar_reconcile_participant_user(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare occurrence uuid;
begin
  for occurrence in select o.id from public.calendar_occurrences o
    where o.status='scheduled' and o.ends_at>statement_timestamp()
      and (o.organizer_id=p_user or p_user=any(o.attendee_ids)
        or eba_private.calendar_required_source(p_user) is not null
        or exists(select 1 from public.calendar_occurrence_participant_sources s where s.occurrence_id=o.id and s.user_id=p_user))
    order by o.id
  loop perform eba_private.calendar_reconcile_occurrence(occurrence); end loop;
end $$;
revoke all on function eba_private.calendar_reconcile_participant_user(uuid) from public,anon,authenticated;
grant execute on function eba_private.calendar_reconcile_participant_user(uuid) to service_role;

create function eba_private.calendar_membership_reconcile_participants()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    perform eba_private.calendar_reconcile_participant_user(new.user_id); return new;
  elsif tg_op='DELETE' then
    perform eba_private.calendar_reconcile_participant_user(old.user_id); return old;
  end if;
  if new.user_id is distinct from old.user_id then perform eba_private.calendar_reconcile_participant_user(old.user_id); end if;
  perform eba_private.calendar_reconcile_participant_user(new.user_id);
  return new;
end $$;
create trigger calendar_membership_participant_reconcile
after insert or update or delete on public.staff_memberships
for each row execute function eba_private.calendar_membership_reconcile_participants();
revoke all on function eba_private.calendar_membership_reconcile_participants() from public,anon,authenticated;

create function eba_private.calendar_assignment_reconcile_participants()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    perform eba_private.calendar_reconcile_participant_user(new.user_id); return new;
  elsif tg_op='DELETE' then
    perform eba_private.calendar_reconcile_participant_user(old.user_id); return old;
  end if;
  if new.user_id is distinct from old.user_id then perform eba_private.calendar_reconcile_participant_user(old.user_id); end if;
  perform eba_private.calendar_reconcile_participant_user(new.user_id);
  return new;
end $$;
create trigger calendar_assignment_participant_reconcile
after insert or update or delete on public.staff_department_assignments
for each row execute function eba_private.calendar_assignment_reconcile_participants();
revoke all on function eba_private.calendar_assignment_reconcile_participants() from public,anon,authenticated;

-- Auth verification, email and ban-status changes affect eligibility as well
-- as membership/assignment changes. Reconcile upcoming audiences synchronously.
create function eba_private.calendar_auth_user_reconcile_participants()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if row(new.email,new.email_confirmed_at,new.deleted_at,new.banned_until)
     is distinct from row(old.email,old.email_confirmed_at,old.deleted_at,old.banned_until) then
    perform eba_private.calendar_reconcile_participant_user(new.id);
  end if;
  return new;
end $$;
create trigger calendar_auth_user_participant_reconcile
after update of email,email_confirmed_at,deleted_at,banned_until on auth.users
for each row execute function eba_private.calendar_auth_user_reconcile_participants();
revoke all on function eba_private.calendar_auth_user_reconcile_participants() from public,anon,authenticated;

-- A dry run is read-only and aggregate-only. Applying is an Admin-only action;
-- each changed occurrence is locked and versioned, which replans reminders and
-- queues Google synchronization through existing triggers.
create function public.calendar_reconcile_required_participants(p_actor uuid,p_apply boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.calendar_occurrences; changed integer:=0; scanned integer:=0; missing_count integer:=0;
  safe_removals integer:=0; stale_department_invites integer:=0; ambiguous_legacy integer:=0;
  limit_conflicts integer:=0; v_changed boolean; n integer;
begin
  if current_user<>'service_role' then raise exception 'Server only'; end if;
  if not exists(select 1 from public.staff_memberships m join auth.users u on u.id=m.user_id
    where m.user_id=p_actor and m.status='active' and m.role in('ceo','admin')
      and u.email_confirmed_at is not null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=statement_timestamp())
      and u.email ~* '^[^@]+@enibrand[.]com$') then raise exception 'Active CEO or Admin required'; end if;
  if p_apply and not exists(select 1 from public.staff_memberships where user_id=p_actor and status='active' and role='admin') then
    raise exception 'Active Admin required to apply reconciliation';
  end if;
  for o in select c.* from public.calendar_occurrences c
    where c.status='scheduled' and c.ends_at>statement_timestamp() order by c.starts_at,c.id
  loop
    scanned:=scanned+1;
    select count(*) into n
      from public.staff_memberships m join auth.users u on u.id=m.user_id
      where m.status='active' and m.user_id<>o.organizer_id
        and eba_private.calendar_required_source(m.user_id) is not null
        and not m.user_id=any(o.attendee_ids);
    missing_count:=missing_count+n;
    select count(*) into n
      from public.calendar_occurrence_participant_sources s
      where s.occurrence_id=o.id and s.source in('required_ceo','required_admin','required_communications_hod')
        and eba_private.calendar_required_source(s.user_id) is null
        and not exists(select 1 from public.calendar_occurrence_participant_sources keep
          where keep.occurrence_id=o.id and keep.user_id=s.user_id
            and keep.source in('explicit_invite','department_invite','google_invitation','legacy_unclassified'));
    safe_removals:=safe_removals+n;
    select count(*) into n
      from public.calendar_occurrence_participant_sources s
      where s.occurrence_id=o.id and s.source='department_invite'
        and not exists(select 1 from public.staff_department_assignments a
          where a.user_id=s.user_id and a.department=any(o.department_targets)
            and public.calendar_reminder_account_active(a.user_id))
        and not exists(select 1 from public.calendar_occurrence_participant_sources keep
          where keep.occurrence_id=o.id and keep.user_id=s.user_id
            and keep.source in('explicit_invite','google_invitation','legacy_unclassified'))
        and eba_private.calendar_required_source(s.user_id) is null;
    stale_department_invites:=stale_department_invites+n;
    select count(*) into n
      from public.calendar_occurrence_participant_sources s
      where s.occurrence_id=o.id and s.source='legacy_unclassified';
    ambiguous_legacy:=ambiguous_legacy+n;
    select count(*) into n from (
      select x.user_id from unnest(o.attendee_ids) x(user_id)
      where not (
        (exists(select 1 from public.calendar_occurrence_participant_sources s
          where s.occurrence_id=o.id and s.user_id=x.user_id
            and s.source in('required_ceo','required_admin','required_communications_hod')
            and eba_private.calendar_required_source(s.user_id) is null)
        and not exists(select 1 from public.calendar_occurrence_participant_sources keep
          where keep.occurrence_id=o.id and keep.user_id=x.user_id
            and keep.source in('explicit_invite','department_invite','google_invitation','legacy_unclassified')))
        or exists(select 1 from public.calendar_occurrence_participant_sources s
          where s.occurrence_id=o.id and s.user_id=x.user_id and s.source='department_invite'
            and not exists(select 1 from public.staff_department_assignments a
              where a.user_id=s.user_id and a.department=any(o.department_targets)
                and public.calendar_reminder_account_active(a.user_id))
            and not exists(select 1 from public.calendar_occurrence_participant_sources keep
              where keep.occurrence_id=o.id and keep.user_id=s.user_id
                and keep.source in('explicit_invite','google_invitation','legacy_unclassified'))
            and eba_private.calendar_required_source(s.user_id) is null)
      )
      union
      select m.user_id from public.staff_memberships m
      where m.status='active' and m.user_id<>o.organizer_id and eba_private.calendar_required_source(m.user_id) is not null
    ) desired;
    if n>100 then limit_conflicts:=limit_conflicts+1; end if;
    if p_apply then
      perform pg_advisory_xact_lock(hashtextextended(o.id::text,0));
      v_changed:=eba_private.calendar_reconcile_occurrence(o.id);
      if v_changed then changed:=changed+1; end if;
    end if;
  end loop;
  if p_apply and limit_conflicts>0 then
    raise exception 'Required participant reconciliation exceeds the 100-attendee limit for % upcoming meeting(s); review those attendee lists before retrying',limit_conflicts;
  end if;
  return jsonb_build_object('applied',coalesce(p_apply,false),'upcoming_occurrences_scanned',scanned,
    'missing_required_participants',missing_count,'safely_removable_stale_mandatory',safe_removals,
    'stale_department_invites_removable',stale_department_invites,
    'legacy_reason_unknown_preserved',ambiguous_legacy,'occurrences_changed',changed,
    'attendee_limit_conflicts',limit_conflicts,
    'unsupported_external_google_events','not imported or disclosed; ask the event owner to invite the required people');
end $$;
revoke all on function public.calendar_reconcile_required_participants(uuid,boolean) from public,anon,authenticated;
grant execute on function public.calendar_reconcile_required_participants(uuid,boolean) to service_role;

create or replace function public.calendar_google_people(p_ids uuid[]) returns table(user_id uuid,email text)
language sql stable security invoker set search_path='' as $$
  select u.id,u.email::text from auth.users u join public.staff_memberships m on m.user_id=u.id
  where u.id=any(p_ids) and m.status='active' and m.role in('ceo','admin','hod')
    and u.email_confirmed_at is not null and u.email ~* '^[^@]+@enibrand[.]com$'
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
    and (m.role in('ceo','admin') or exists(select 1 from public.staff_department_assignments a
      where a.user_id=m.user_id));
$$;
revoke all on function public.calendar_google_people(uuid[]) from public,anon,authenticated;
grant execute on function public.calendar_google_people(uuid[]) to service_role;

-- Realtime and direct alert reads must lose stale meeting reminders as soon
-- as a person's current attendee access is revoked. Existing chat notification
-- policies remain in place; this replaces only the restrictive calendar gate.
drop policy if exists "Calendar alerts require current occurrence visibility" on public.hub_notifications;
create policy "Calendar alerts require current occurrence visibility" on public.hub_notifications
  as restrictive for all to authenticated
  using (calendar_occurrence_id is null or ((select public.calendar_access()) and exists(
    select 1 from public.calendar_occurrences o where o.id=calendar_occurrence_id
      and o.reminder_revision=calendar_revision
      and (o.organizer_id=(select auth.uid()) or (select auth.uid())=any(o.attendee_ids)))))
  with check (calendar_occurrence_id is null or ((select public.calendar_access()) and exists(
    select 1 from public.calendar_occurrences o where o.id=calendar_occurrence_id
      and o.reminder_revision=calendar_revision
      and (o.organizer_id=(select auth.uid()) or (select auth.uid())=any(o.attendee_ids)))));

notify pgrst,'reload schema';
commit;
