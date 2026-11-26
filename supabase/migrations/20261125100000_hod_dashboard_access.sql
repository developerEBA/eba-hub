-- HOD dashboard foundation. Apply only after reviewing the read-only preflight.
-- This migration does not create staff/accounts or derive department assignments.
begin;

do $$ begin
  if to_regclass('public.staff_memberships') is null
    or to_regclass('public.staff_department_assignments') is null
    or to_regclass('public.staff_access_profiles') is null
    or to_regclass('public.department_plans') is null
    or to_regclass('public.approval_requests') is null
    or to_regclass('public.connect_conversations') is null
    or to_regclass('public.announcements') is null
    or to_regclass('public.period_recognition_results') is null
    or to_regclass('public.game_rooms') is null
    or to_regclass('public.calendar_occurrences') is null then
    raise exception 'HOD dashboard prerequisites are missing; apply the listed base migrations first';
  end if;
end $$;

create or replace function eba_private.hod_dashboard_member(person uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.staff_memberships m
    join auth.users u on u.id=m.user_id
    where m.user_id=person and m.role='hod' and m.status='active'
      and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
      and u.email_confirmed_at is not null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and exists(select 1 from public.staff_department_assignments a where a.user_id=m.user_id)
  );
$$;
revoke all on function eba_private.hod_dashboard_member(uuid) from public,anon,authenticated;
grant execute on function eba_private.hod_dashboard_member(uuid) to authenticated,service_role;

create or replace function eba_private.hod_in_department(person uuid, department_id text)
returns boolean language sql stable security definer set search_path=''
as $$ select eba_private.hod_dashboard_member(person) and exists(
  select 1 from public.staff_department_assignments a where a.user_id=person and a.department=department_id
) $$;
revoke all on function eba_private.hod_in_department(uuid,text) from public,anon,authenticated;
grant execute on function eba_private.hod_in_department(uuid,text) to authenticated,service_role;

-- Preserve multi-department assignments when Settings edits a member.
create function public.staff_access_update_assignments(p_actor uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare target uuid; member public.staff_memberships; role_name text; display_name text;
  selected text[]; old_assignments text[];
begin
 if current_user<>'service_role' then raise exception 'Server only'; end if;
 if not exists(select 1 from public.staff_memberships m join auth.users u on u.id=m.user_id
   where m.user_id=p_actor and m.role='admin' and m.status='active'
     and u.email_confirmed_at is not null and u.deleted_at is null
     and (u.banned_until is null or u.banned_until<=clock_timestamp())
     and lower(u.email) ~ '^[^@]+@enibrand[.]com$') then raise exception 'Active Admin required'; end if;
 target:=(p_data->>'id')::uuid;
 if target=p_actor then raise exception 'Cannot change your own access'; end if;
 role_name:=p_data->>'role'; display_name:=btrim(p_data->>'name');
 select array_agg(value order by value) into selected
   from (select distinct jsonb_array_elements_text(p_data->'departments') as value) d;
 if role_name not in('staff','hod') or display_name is null or length(display_name) not between 1 and 120
   or coalesce(cardinality(selected),0) not between 1 and 5
   or not selected <@ array['graphics','development','communications','events','marketing']::text[] then
   raise exception 'Invalid staff assignment';
 end if;
 perform pg_advisory_xact_lock(1911191300);
 select * into member from public.staff_memberships where user_id=target for update;
 if not found or member.role in('ceo','admin') then raise exception 'Staff record unavailable'; end if;
 if member.access_version is distinct from (p_data->>'version')::integer then raise exception 'Staff record changed'; end if;
 if not exists(select 1 from auth.users u where u.id=target and u.email_confirmed_at is not null
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and lower(u.email) ~ '^[^@]+@enibrand[.]com$') then raise exception 'Verified company account required'; end if;
 select coalesce(array_agg(department order by department),'{}') into old_assignments
   from public.staff_department_assignments where user_id=target;
 update public.staff_memberships set role=role_name,access_version=access_version+1 where user_id=target;
 insert into public.staff_access_profiles(user_id,name) values(target,display_name)
   on conflict(user_id) do update set name=excluded.name;
 delete from public.staff_department_assignments where user_id=target;
 insert into public.staff_department_assignments(user_id,department)
   select target,d.department from unnest(selected) as d(department);
 insert into public.staff_access_audit(actor,action,target,changes)
   select p_actor,'update',u.email,jsonb_build_object('before',jsonb_build_object('role',member.role,'status',member.status,'departments',old_assignments),
     'after',jsonb_build_object('role',role_name,'status',member.status,'departments',selected))
   from auth.users u where u.id=target;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_access_update_assignments(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.staff_access_update_assignments(uuid,jsonb) to service_role;

-- HODs may inspect only their own current department assignments.
drop policy if exists "Own staff department assignments" on public.staff_department_assignments;
create policy "Read own active department assignments" on public.staff_department_assignments for select to authenticated
  using (user_id=(select auth.uid()) and (
    exists(select 1 from public.staff_memberships m where m.user_id=auth.uid() and m.status='active' and m.role in('ceo','admin'))
    or eba_private.hod_dashboard_member(auth.uid())
  ));

-- The existing typed-room policies already check role, actual assignment and
-- participant IDs; enabling active HOD profiles makes those checks reachable.
create or replace function eba_private.connect_is_active(person uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.staff_memberships m join auth.users u on u.id=m.user_id
    where m.user_id=person and m.status='active'
      and lower(u.email) ~ '^[^@]+@enibrand[.]com$' and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and (m.role in('ceo','admin') or (m.role='hod' and exists(
        select 1 from public.staff_department_assignments a where a.user_id=m.user_id))))
$$;
revoke all on function eba_private.connect_is_active(uuid) from public,anon,authenticated;
grant execute on function eba_private.connect_is_active(uuid),eba_private.connect_has_joined(uuid),
  eba_private.connect_can_read(uuid),eba_private.connect_can_write(uuid) to authenticated;

-- This helper is deliberately local to Connect notifications: widening the
-- general hub_is_active() helper would also widen clients and recognition.
drop policy if exists "Read own authorized alerts" on public.hub_notifications;
create policy "Read own authorized alerts" on public.hub_notifications for select to authenticated
  using (recipient_id=(select auth.uid()) and eba_private.connect_is_active(auth.uid())
    and (conversation_id is null or eba_private.connect_can_read(conversation_id)));
drop policy if exists "Mark own authorized alerts read" on public.hub_notifications;
create policy "Mark own authorized alerts read" on public.hub_notifications for update to authenticated
  using (recipient_id=(select auth.uid()) and eba_private.connect_is_active(auth.uid())
    and (conversation_id is null or eba_private.connect_can_read(conversation_id)))
  with check (recipient_id=(select auth.uid()) and eba_private.connect_is_active(auth.uid()) and read_at is not null
    and (conversation_id is null or eba_private.connect_can_read(conversation_id)));

create or replace function public.calendar_access() returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and status='active' and role in('ceo','admin'))
    and coalesce((select auth.jwt())->>'email','') ~* '^[^@]+@enibrand[.]com$'
    or eba_private.hod_dashboard_member(auth.uid());
$$;

-- Keep private calendar reminders available to active HODs who are current
-- organizers or explicitly invited participants. Employee dashboard access
-- remains blocked.
create or replace function public.calendar_reminder_account_active(p_user uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.staff_memberships m join auth.users u on u.id=m.user_id
    where m.user_id=p_user and m.status='active' and m.role in ('ceo','admin','hod')
      and u.email ~* '^[^@]+@enibrand[.]com$' and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
      and (m.role<>'hod' or exists(select 1 from public.staff_department_assignments a where a.user_id=m.user_id)));
$$;
revoke all on function public.calendar_reminder_account_active(uuid) from public,anon,authenticated;
grant execute on function public.calendar_reminder_account_active(uuid) to service_role;

-- Narrow HOD meeting creation RPC. It cannot edit/cancel existing events and
-- materializes invitees only from active assigned HOD/CEO/Admin accounts.
create function public.calendar_hod_create(p_actor uuid,p_request uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_title text; v_agenda text; v_start timestamptz; v_end timestamptz; v_until date;
  v_frequency text; v_departments text[]; v_selected uuid[]; v_attendees uuid[];
  v_hash text; v_id uuid; v_first uuid; v_series uuid; v_count integer; i integer; existing public.calendar_requests;
begin
  if current_user<>'service_role' then raise exception 'Server only'; end if;
  if not eba_private.hod_dashboard_member(p_actor) then raise exception 'Active assigned HOD required'; end if;
  if p_request is null then raise exception 'Request ID required'; end if;
  v_hash:=md5(jsonb_build_object('command','create','id',null,'scope','one','version',null,'payload',p_payload)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,0));
  select * into existing from public.calendar_requests where actor_id=p_actor and request_id=p_request;
  if found then
    if existing.request_hash<>v_hash then raise exception 'Request ID was already used for another change'; end if;
    return existing.occurrence_id;
  end if;
  v_title:=btrim(p_payload->>'title'); v_agenda:=nullif(btrim(p_payload->>'agenda'),'');
  v_start:=(p_payload->>'startsAt')::timestamptz; v_end:=(p_payload->>'endsAt')::timestamptz;
  v_frequency:=p_payload->>'frequency'; v_until:=(p_payload->>'until')::date;
  if v_title is null or length(v_title) not between 1 and 160 or length(v_agenda)>4000 or v_start is null or v_end is null
    or v_start<=statement_timestamp() or v_end<=v_start or v_end>v_start+interval '24 hours' then raise exception 'Invalid title, agenda or meeting times'; end if;
  if v_frequency is null or v_frequency not in ('once','weekly') then raise exception 'Choose a one-off or weekly meeting'; end if;
  if v_frequency='weekly' and (v_until is null or v_until<(v_start at time zone 'Africa/Lagos')::date or v_until>(v_start at time zone 'Africa/Lagos')::date+364) then raise exception 'Weekly end date must be within 52 weeks'; end if;
  if v_frequency='once' then v_until:=null; end if;
  select coalesce(array_agg(distinct value),'{}') into v_departments from jsonb_array_elements_text(coalesce(p_payload->'departments','[]'));
  select coalesce(array_agg(distinct value::uuid),'{}') into v_selected from jsonb_array_elements_text(coalesce(p_payload->'attendees','[]'));
  if cardinality(v_departments) not between 1 and 5 or cardinality(v_selected)>100
    or not v_departments <@ array['graphics','development','communications','events','marketing']::text[]
    or exists(select 1 from unnest(v_departments) d where not exists(select 1 from public.staff_department_assignments a where a.user_id=p_actor and a.department=d)) then
    raise exception 'Choose only currently assigned departments';
  end if;
  if exists(select 1 from unnest(v_selected) person where not exists(
    select 1 from public.staff_department_assignments a join public.staff_memberships m on m.user_id=a.user_id
    where a.user_id=person and a.department=any(v_departments) and m.status='active' and m.role in('ceo','admin','hod')
      and public.calendar_reminder_account_active(person))) then raise exception 'Select only active assigned HODs, CEOs or Admins'; end if;
  select coalesce(array_agg(distinct person),'{}') into v_attendees from (
    select unnest(v_selected) person union
    select a.user_id from public.staff_department_assignments a join public.staff_memberships m on m.user_id=a.user_id
      where a.department=any(v_departments) and m.status='active' and m.role in('ceo','admin','hod')
        and public.calendar_reminder_account_active(a.user_id)
  ) eligible where person<>p_actor;
  if cardinality(v_attendees) not between 1 and 100 then raise exception 'No other eligible assigned meeting attendees are available'; end if;
  v_series:=p_request;
  insert into public.calendar_series(id,organizer_id,frequency,recurrence_until) values(v_series,p_actor,v_frequency,v_until);
  v_count:=case when v_frequency='weekly' then ((v_until-(v_start at time zone 'Africa/Lagos')::date)/7)+1 else 1 end;
  for i in 0..v_count-1 loop
    insert into public.calendar_occurrences(series_id,organizer_id,ordinal,original_starts_at,title,agenda,starts_at,ends_at,frequency,recurrence_until,attendee_ids,department_targets,audience)
      values(v_series,p_actor,i,v_start+i*interval '7 days',v_title,v_agenda,v_start+i*interval '7 days',v_end+i*interval '7 days',v_frequency,v_until,v_attendees,v_departments,'department')
      returning id into v_id;
    if i=0 then v_first:=v_id; end if;
  end loop;
  insert into public.calendar_requests(actor_id,request_id,request_hash,occurrence_id) values(p_actor,p_request,v_hash,v_first);
  return v_first;
end $$;
revoke all on function public.calendar_hod_create(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_hod_create(uuid,uuid,jsonb) to service_role;

-- Existing occurrence policy still requires organizer or explicit attendee;
-- current department membership does not grant access to historic meetings.
drop policy if exists "Organizer reads series metadata" on public.calendar_series;
create policy "Active organizers read their series metadata" on public.calendar_series for select to authenticated
  using ((select public.calendar_access()) and organizer_id=(select auth.uid()));
drop policy if exists "Only organizer and invited people read occurrences" on public.calendar_occurrences;
create policy "Only organizer and explicitly invited people read occurrences" on public.calendar_occurrences for select to authenticated
  using ((select public.calendar_access()) and (organizer_id=(select auth.uid()) or (select auth.uid())=any(attendee_ids)));

create or replace function public.games_access() returns boolean
language sql stable security invoker set search_path='' as $$
  select (exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and status='active' and role in('ceo','admin'))
    and coalesce((select auth.jwt())->>'email','') ~* '^[^@]+@enibrand[.]com$')
    or eba_private.hod_dashboard_member(auth.uid());
$$;

-- Keep public member/profile query APIs aligned with the current active HOD
-- assignment. Employee/client users are never included by this helper.
create or replace function public.connect_department_members(room uuid)
-- Keep the established PostgREST result shape. CREATE OR REPLACE cannot change
-- OUT columns on an existing function; callers also consume these three fields.
returns table(user_id uuid,display_name text,avatar_url text)
language sql stable security definer set search_path='' as $$
 select p.user_id,p.display_name,p.avatar_url
 from public.connect_conversations c join public.connect_profiles p on true join public.staff_memberships m on m.user_id=p.user_id
 join public.staff_department_assignments a on a.user_id=p.user_id
 join auth.users u on u.id=p.user_id
 where c.id=room and c.room_type='department' and eba_private.connect_can_read(room)
   and a.department=c.department and m.status='active' and m.role in('staff','hod','ceo','admin')
   and lower(u.email) ~ '^[^@]+@enibrand[.]com$' and u.email_confirmed_at is not null
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
   and (m.role not in('staff','hod') or eba_private.connect_is_active(m.user_id))
 union
 select p.user_id,p.display_name,p.avatar_url
 from public.connect_conversations c join public.connect_profiles p on true join public.staff_memberships m on m.user_id=p.user_id
 join auth.users u on u.id=p.user_id
 where c.id=room and c.room_type='department' and eba_private.connect_can_read(room)
   and m.role in('ceo','admin') and m.status='active'
   and lower(u.email) ~ '^[^@]+@enibrand[.]com$' and u.email_confirmed_at is not null
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 order by 2,1;
$$;
revoke all on function public.connect_department_members(uuid) from public,anon;
grant execute on function public.connect_department_members(uuid) to authenticated;

-- HOD announcement recipient access is separate from the management helper.
-- No draft, audit or management records become visible to HODs.
create or replace function eba_private.announcement_recipient_access(record_id uuid,rev integer)
returns boolean language sql stable security definer set search_path=''
as $$ select (
  eba_private.announcement_active() or eba_private.hod_dashboard_member(auth.uid())
) and exists(
 select 1 from public.announcements a join public.announcement_revisions r
 on r.announcement_id=a.id and r.revision=a.current_revision
 where a.id=record_id and a.status='published' and r.revision=rev and r.published_at is not null
 and r.superseded_at is null and r.archived_at is null
 and (r.expires_at is null or r.expires_at>clock_timestamp())
 and (r.audience_type='company' or exists(
   select 1 from public.staff_department_assignments d where d.user_id=auth.uid() and d.department=any(r.departments)
 ))
) $$;

create or replace function public.announcement_next()
returns jsonb language plpgsql security definer set search_path='' as $$
declare person uuid:=auth.uid(); result jsonb;
begin
 if not (eba_private.announcement_active() or eba_private.hod_dashboard_member(person)) then raise exception 'Active workspace membership required'; end if;
 select jsonb_build_object('id',a.id,'revision',r.revision,'title',r.title,'body',r.body,'published_at',r.published_at)
 into result from public.announcements a join public.announcement_revisions r
 on r.announcement_id=a.id and r.revision=a.current_revision
 where eba_private.announcement_recipient_access(a.id,r.revision)
 and not exists(select 1 from public.announcement_acknowledgements k where k.announcement_id=a.id and k.revision=r.revision and k.user_id=person)
 order by r.published_at,a.id limit 1;
 return result;
end $$;

-- Published results only. Nomination/review policies and RPCs stay unchanged.
create policy "Active HODs read published recognition results" on public.period_recognition_results for select to authenticated
  using (eba_private.hod_dashboard_member(auth.uid()));

create policy "Assigned HODs read submitted department plans" on public.department_plans for select to authenticated
  using (status='submitted' and eba_private.hod_in_department(auth.uid(),department));

-- HOD-authored drafts and verified task ownership. Existing free-text owners
-- remain untouched; only newly assigned tasks receive verified IDs/timestamps.
alter table public.department_plans add column if not exists version integer not null default 1 check(version>0);
alter table public.department_plans add column if not exists created_by uuid references auth.users(id);
alter table public.department_plans add column if not exists submitted_by uuid references auth.users(id);
alter table public.department_plans add column if not exists submitted_at timestamptz;
alter table public.department_plan_items add column if not exists assignee_user_id uuid references auth.users(id);
alter table public.department_plan_items add column if not exists assigned_at timestamptz;
alter table public.department_plan_items add column if not exists completed_at timestamptz;
alter table public.department_plan_items add column if not exists completed_by uuid references auth.users(id);
grant select(version,created_by,submitted_by,submitted_at) on public.department_plans to authenticated;
grant select(assignee_user_id,assigned_at,completed_at,completed_by) on public.department_plan_items to authenticated;
create policy "HOD authors read their assigned department drafts" on public.department_plans for select to authenticated
  using (status='draft' and created_by=auth.uid() and eba_private.hod_in_department(auth.uid(),department));

create or replace function eba_private.staff_assigned_account(person uuid,department_id text)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.staff_memberships m join auth.users u on u.id=m.user_id
  join public.staff_department_assignments a on a.user_id=m.user_id
  where m.user_id=person and m.role in('staff','hod') and m.status='active' and a.department=department_id
    and lower(u.email) ~ '^[^@]+@enibrand[.]com$' and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp())) $$;
revoke all on function eba_private.staff_assigned_account(uuid,text) from public,anon,authenticated;
grant execute on function eba_private.staff_assigned_account(uuid,text) to service_role;

create table public.hod_department_plan_requests(
 actor_id uuid not null references auth.users(id),request_id uuid not null,request_hash text not null,response jsonb not null,
 created_at timestamptz not null default statement_timestamp(),primary key(actor_id,request_id));
alter table public.hod_department_plan_requests enable row level security;
revoke all on public.hod_department_plan_requests from public,anon,authenticated;

create function public.hod_department_plan_save(p_request uuid,p_department text,p_period_kind text,p_period_start date,p_plan_id uuid,
  p_expected_version integer,p_title text,p_summary text,p_items jsonb,p_submit boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person uuid:=auth.uid(); plan public.department_plans; item jsonb; item_id uuid; task_title text; task_owner uuid; task_due date; task_status text;
  v_hash text; prior public.hod_department_plan_requests; result jsonb;
begin
 if not eba_private.hod_in_department(person,p_department) then raise insufficient_privilege using message='Assigned HOD access required'; end if;
 if p_request is null then raise exception 'Request ID required'; end if;
 v_hash:=md5(jsonb_build_object('department',p_department,'period_kind',p_period_kind,'period_start',p_period_start,'plan_id',p_plan_id,
   'expected_version',p_expected_version,'title',p_title,'summary',p_summary,'items',p_items,'submit',p_submit)::text);
 perform pg_advisory_xact_lock(hashtextextended(person::text||p_request::text,0));
 select * into prior from public.hod_department_plan_requests where actor_id=person and request_id=p_request;
 if found then if prior.request_hash<>v_hash then raise exception 'Request ID was already used for another change'; end if; return prior.response; end if;
 if p_period_kind is null or p_period_kind not in('week','month','year') or p_period_start is null
   or (p_period_kind='week' and extract(isodow from p_period_start)<>1)
   or (p_period_kind='month' and extract(day from p_period_start)<>1)
   or (p_period_kind='year' and extract(doy from p_period_start)<>1) then raise exception 'Choose a valid plan period'; end if;
 if length(btrim(coalesce(p_title,''))) not between 1 and 160 or length(coalesce(p_summary,''))>4000
   or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>50 then raise exception 'Complete the plan title, summary and valid work items'; end if;
 if p_plan_id is null then
   if p_expected_version is not null then raise exception 'Refresh before creating the plan'; end if;
   insert into public.department_plans(department,period_kind,period_start,title,summary,status,created_by)
     values(p_department,p_period_kind,p_period_start,btrim(p_title),btrim(coalesce(p_summary,'')),'draft',person)
     returning * into plan;
 else
   select * into plan from public.department_plans where id=p_plan_id and department=p_department
     and period_kind=p_period_kind and period_start=p_period_start for update;
   if not found or plan.status<>'draft' or plan.created_by<>person then raise insufficient_privilege using message='This draft is unavailable or read-only'; end if;
   if plan.version<>p_expected_version then raise exception 'Plan changed; refresh before saving'; end if;
   update public.department_plans set title=btrim(p_title),summary=btrim(coalesce(p_summary,'')),version=version+1
     where id=plan.id returning * into plan;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
   task_title:=btrim(item->>'title'); task_owner:=nullif(item->>'assignee_user_id','')::uuid;
   task_due:=nullif(item->>'due_date','')::date; task_status:=coalesce(nullif(item->>'status',''),'not_started');
   if length(coalesce(task_title,'')) not between 1 and 160 or task_owner is null
     or task_status not in('not_started','in_progress','blocked','completed')
     or not eba_private.staff_assigned_account(task_owner,p_department) then raise exception 'Assign each work item to a current real department member'; end if;
   item_id:=nullif(item->>'id','')::uuid;
   if item_id is null then
     insert into public.department_plan_items(plan_id,title,owner,due_date,status,assignee_user_id,assigned_at,completed_at,completed_by)
     select plan.id,task_title,p.name,task_due,task_status,task_owner,statement_timestamp(),case when task_status='completed' then statement_timestamp() else null end,case when task_status='completed' then person else null end
       from public.connect_profiles p where p.user_id=task_owner;
     if not found then raise exception 'Assigned member profile is unavailable'; end if;
   else
     update public.department_plan_items t set title=task_title,owner=p.name,due_date=task_due,status=task_status,
       assigned_at=case when t.assignee_user_id is distinct from task_owner then statement_timestamp() else t.assigned_at end,
       completed_at=case when task_status='completed' and t.status<>'completed' then statement_timestamp()
                         when task_status<>'completed' then null else t.completed_at end,
       completed_by=case when task_status='completed' and t.status<>'completed' then person
                         when task_status<>'completed' then null else t.completed_by end,
       assignee_user_id=task_owner
       from public.connect_profiles p where t.id=item_id and t.plan_id=plan.id and p.user_id=task_owner;
     if not found then raise exception 'Work item is unavailable'; end if;
   end if;
 end loop;
 delete from public.department_plan_items t where t.plan_id=plan.id and not exists(
   select 1 from jsonb_array_elements(p_items) value where nullif(value->>'id','')::uuid=t.id);
 if p_submit then
   update public.department_plans set status='submitted',submitted_by=person,submitted_at=statement_timestamp(),version=version+1
     where id=plan.id returning * into plan;
 end if;
 result:=jsonb_build_object('id',plan.id,'version',plan.version,'status',plan.status);
 insert into public.hod_department_plan_requests(actor_id,request_id,request_hash,response) values(person,p_request,v_hash,result);
 return result;
end $$;
revoke all on function public.hod_department_plan_save(uuid,text,text,date,uuid,integer,text,text,jsonb,boolean) from public,anon;
grant execute on function public.hod_department_plan_save(uuid,text,text,date,uuid,integer,text,text,jsonb,boolean) to authenticated;

-- Own supported requests are visible to their requester. Review and decision
-- permissions remain executive-only, and private leave files stay linked.
alter table public.approval_requests add column if not exists requester_id uuid references auth.users(id);
grant insert (title,request_type,department,requester_name,message,external_url,start_date,end_date,attachment_names,requester_id)
  on public.approval_requests to authenticated;
create policy "HODs read only their own submitted requests" on public.approval_requests for select to authenticated
  using (requester_id=auth.uid() and eba_private.hod_dashboard_member(auth.uid()));
create policy "HODs submit requests for themselves" on public.approval_requests for insert to authenticated
  with check (requester_id=auth.uid() and reviewer_id is null and reviewer_email is null and decided_at is null
    and decision_note is null and status='pending' and eba_private.hod_dashboard_member(auth.uid()));

create policy "HODs read only their own approval documents" on storage.objects for select to authenticated
  using (bucket_id='approval-request-files' and exists(
    select 1 from public.approval_requests r where r.requester_id=auth.uid()
      and r.id::text=split_part(storage.objects.name,'/',1)
      and storage.objects.name=r.id::text||'/'||split_part(storage.objects.name,'/',2)
      and split_part(storage.objects.name,'/',2)=any(r.attachment_names)
  ));

-- Keep the established Admin invitation workflow and staff directory accurate
-- after HOD access launches. Employees remain unavailable.
do $$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('public.staff_access_control(text,uuid,jsonb)'::regprocedure);
 old:='return jsonb_build_object(''ok'',true,''dashboard_available'',false);';
 replacement:='return jsonb_build_object(''ok'',true,''dashboard_available'',invite.role=''hod'');';
 if position(old in definition)=0 then raise exception 'Expected staff invitation acceptance response is missing'; end if;
 definition:=replace(definition,old,replacement);
 old:='m.status=''active'' and m.role in(''ceo'',''admin'') and lower(a.email) ~ ''^[^@]+@enibrand[.]com$'' and a.email_confirmed_at is not null and a.deleted_at is null and (a.banned_until is null or a.banned_until<=clock_timestamp()) as hub_access';
 replacement:='m.status=''active'' and (m.role in(''ceo'',''admin'') or (m.role=''hod'' and exists(select 1 from public.staff_department_assignments d where d.user_id=m.user_id))) and lower(a.email) ~ ''^[^@]+@enibrand[.]com$'' and a.email_confirmed_at is not null and a.deleted_at is null and (a.banned_until is null or a.banned_until<=clock_timestamp()) as hub_access';
 if position(old in definition)=0 then raise exception 'Expected staff directory dashboard eligibility expression is missing'; end if;
 execute replace(definition,old,replacement);
end $$;

-- Extend only the two server-only Games RPCs. Dynamic replacement preserves
-- their existing move validation and transaction logic while adding explicit
-- active-HOD checks. HOD invitations are limited to shared real assignments.
do $$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('public.games_lobby_command(uuid,uuid,uuid,text,jsonb)'::regprocedure);
 old:='where m.user_id=p_actor and m.status=''active'' and m.role in (''ceo'',''admin'');';
 replacement:='where m.user_id=p_actor and m.status=''active'' and m.role in (''ceo'',''admin'',''hod'') and (m.role<>''hod'' or eba_private.hod_dashboard_member(p_actor));';
 if position(old in definition)=0 then raise exception 'Expected Games lobby authorization clause is missing'; end if;
 definition:=replace(definition,old,replacement);
 old:='if not exists(select 1 from public.staff_memberships m where m.user_id=v_target and m.status=''active'' and m.role in (''ceo'',''admin'')) then raise exception ''Eligible Hub member required''; end if;';
 replacement:='if not exists(select 1 from public.staff_memberships m where m.user_id=v_target and m.status=''active'' and m.role in (''ceo'',''admin'',''hod'') and eba_private.connect_is_active(v_target) and (m.role<>''hod'' or eba_private.hod_dashboard_member(v_target)) and (v_role<>''hod'' or exists(select 1 from public.staff_department_assignments a join public.staff_department_assignments b on b.department=a.department where a.user_id=p_actor and b.user_id=v_target))) then raise exception ''Eligible assigned Hub member required''; end if;';
 if position(old in definition)=0 then raise exception 'Expected Games invite authorization clause is missing'; end if;
 definition:=replace(definition,old,replacement);
 execute definition;

 definition:=pg_get_functiondef('public.games_commit(uuid,uuid,uuid,integer,jsonb,text,integer)'::regprocedure);
 old:='if not exists(select 1 from public.staff_memberships m where m.user_id=p_actor and m.status=''active'' and m.role in (''ceo'',''admin'')) then raise exception ''Hub membership required''; end if;';
 replacement:='if not exists(select 1 from public.staff_memberships m where m.user_id=p_actor and m.status=''active'' and m.role in (''ceo'',''admin'',''hod'') and (m.role<>''hod'' or eba_private.hod_dashboard_member(p_actor))) then raise exception ''Hub membership required''; end if;';
 if position(old in definition)=0 then raise exception 'Expected Games move authorization clause is missing'; end if;
 execute replace(definition,old,replacement);
end $$;

notify pgrst,'reload schema';
commit;
