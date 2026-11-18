-- Part 3: private in-app only. No Google calls or alert delivery in migration.
begin;
alter table public.calendar_occurrences add column reminder_revision integer not null default 1 check (reminder_revision>0);
grant select(reminder_revision) on public.calendar_occurrences to authenticated;
alter table public.calendar_reminders add column schedule_revision integer not null default 1 check (schedule_revision>0);
-- Locate the original unnamed key through its columns, not a guessed truncated name.
do $$ declare key_name text; begin
  select c.conname into key_name from pg_constraint c where c.conrelid='public.calendar_reminders'::regclass and c.contype='u'
    and (select array_agg(a.attname::text order by x.ord) from unnest(c.conkey) with ordinality x(attnum,ord)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.attnum)=array['occurrence_id','user_id','lead_minutes','channel'];
  if key_name is null then raise exception 'Original reminder key missing; inspect preflight'; end if;
  execute format('alter table public.calendar_reminders drop constraint %I',key_name);
end $$;
alter table public.calendar_reminders add constraint calendar_reminders_revision_stage_key
  unique(occurrence_id,schedule_revision,user_id,lead_minutes,channel);
alter table public.calendar_reminders drop constraint calendar_reminders_status_check;
alter table public.calendar_reminders add constraint calendar_reminders_status_check
  check(status in ('pending_setup','scheduled','processing','needs_reschedule','cancelled','sent','skipped'));

alter table public.hub_notifications
  add column calendar_occurrence_id uuid references public.calendar_occurrences(id) on delete cascade,
  add column calendar_revision integer,
  add column calendar_lead_minutes integer;
alter table public.hub_notifications drop constraint hub_notifications_check;
alter table public.hub_notifications add constraint hub_notifications_check check (
  (calendar_occurrence_id is null and calendar_revision is null and calendar_lead_minutes is null and (
    (approval_id is not null and message_id is null and conversation_id is null and client_message_id is null)
    or (approval_id is null and message_id is not null and conversation_id is not null and client_message_id is null)
    or (approval_id is null and message_id is null and conversation_id is null and client_message_id is not null)))
  or (calendar_occurrence_id is not null and calendar_revision is not null and calendar_lead_minutes is not null
    and calendar_revision>0 and calendar_lead_minutes in (60,10,0)
    and approval_id is null and message_id is null and conversation_id is null and client_message_id is null)
);
create unique index hub_calendar_reminder_once on public.hub_notifications(recipient_id,calendar_occurrence_id,calendar_revision,calendar_lead_minutes)
  where calendar_occurrence_id is not null;
create index hub_calendar_reminder_occurrence on public.hub_notifications(calendar_occurrence_id) where calendar_occurrence_id is not null;

-- Explicit column grants: no SELECT * or auth password/session columns required.
grant usage on schema auth to service_role;
grant select(id,email,email_confirmed_at,deleted_at,banned_until) on auth.users to service_role;
grant select(user_id,role,status) on public.staff_memberships to service_role;
grant select(id,recipient_id,calendar_occurrence_id,calendar_revision,calendar_lead_minutes,created_at,read_at),
  insert(recipient_id,calendar_occurrence_id,calendar_revision,calendar_lead_minutes,created_at),update(read_at)
  on public.hub_notifications to service_role;
do $$ declare seq regclass:=pg_get_serial_sequence('public.hub_notifications','id')::regclass; begin
  if seq is null then raise exception 'Notification identity sequence missing'; end if;
  execute format('grant usage on sequence %s to service_role',seq);
end $$;
-- Existing own-alert and client-message policies remain. Add a restrictive gate
-- only for calendar alerts; occurrence RLS rechecks current participants/status.
create policy "Calendar alerts require current occurrence visibility" on public.hub_notifications
  as restrictive for all to authenticated
  using (calendar_occurrence_id is null or ((select public.calendar_access()) and exists(
    select 1 from public.calendar_occurrences o where o.id=calendar_occurrence_id and o.reminder_revision=calendar_revision)))
  with check (calendar_occurrence_id is null or ((select public.calendar_access()) and exists(
    select 1 from public.calendar_occurrences o where o.id=calendar_occurrence_id and o.reminder_revision=calendar_revision)));

create function public.calendar_reminder_account_active(p_user uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.staff_memberships m join auth.users u on u.id=m.user_id
    where m.user_id=p_user and m.status='active' and m.role in ('ceo','admin')
      and u.email ~* '^[^@]+@enibrand[.]com$' and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp()));
$$;
revoke all on function public.calendar_reminder_account_active(uuid) from public,anon,authenticated;
grant execute on function public.calendar_reminder_account_active(uuid) to service_role;

create function public.calendar_set_reminder_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  new.reminder_revision:=old.reminder_revision+case when new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at or (old.status='cancelled' and new.status='scheduled') then 1 else 0 end;
  return new;
end $$;
create trigger calendar_reminder_revision before update of starts_at,ends_at,status on public.calendar_occurrences
  for each row execute function public.calendar_set_reminder_revision();
revoke all on function public.calendar_set_reminder_revision() from public,anon,authenticated;

create function public.calendar_plan_reminders(p_occurrence uuid,p_now timestamptz default null) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.calendar_occurrences; v_now timestamptz:=coalesce(p_now,statement_timestamp());
begin
  select * into o from public.calendar_occurrences where id=p_occurrence for update;
  if not found then return; end if;
  update public.calendar_reminders set status='cancelled',scheduled_for=null,invalidated_at=v_now
    where occurrence_id=o.id and channel='hub' and status<>'sent'
      and (lead_minutes not in (60,10,0) or schedule_revision<>o.reminder_revision or o.status='cancelled'
        or not(user_id=o.organizer_id or user_id=any(o.attendee_ids)));
  if o.status<>'scheduled' then return; end if;
  insert into public.calendar_reminders(occurrence_id,user_id,occurrence_version,schedule_revision,lead_minutes,channel,scheduled_for,status)
    select o.id,p.person,o.version,o.reminder_revision,s.lead,'hub',o.starts_at-make_interval(mins=>s.lead),
      case when o.starts_at-make_interval(mins=>s.lead)>=v_now then 'scheduled' else 'skipped' end
    from (select distinct unnest(array_append(o.attendee_ids,o.organizer_id)) as person) p
    cross join (values(60),(10),(0)) s(lead)
    where public.calendar_reminder_account_active(p.person)
    on conflict(occurrence_id,schedule_revision,user_id,lead_minutes,channel) do update set
      occurrence_version=excluded.occurrence_version,
      scheduled_for=case when calendar_reminders.status='sent' then calendar_reminders.scheduled_for else excluded.scheduled_for end,
      status=case when calendar_reminders.status in ('cancelled','needs_reschedule','pending_setup','processing') then excluded.status else calendar_reminders.status end;
end $$;
revoke all on function public.calendar_plan_reminders(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.calendar_plan_reminders(uuid,timestamptz) to service_role;

create or replace function public.calendar_invalidate_reminders() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' or new.version is distinct from old.version or new.status is distinct from old.status
    or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at or new.attendee_ids is distinct from old.attendee_ids then
    perform public.calendar_plan_reminders(new.id);
    -- Wake the existing inbox subscription without changing mark-read state.
    update public.hub_notifications set read_at=read_at where calendar_occurrence_id=new.id;
  end if;
  return new;
end $$;
create trigger calendar_new_occurrence_reminders after insert on public.calendar_occurrences
  for each row execute function public.calendar_invalidate_reminders();

-- No external I/O or persistent claims: lock the occurrence, validate, insert the
-- private alert and finish its job in this same transaction. Test clocks are
-- service-role-only; the HTTP worker never accepts or passes a client clock.
create function public.calendar_deliver_reminders(p_now timestamptz default null,p_limit integer default 10) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='1s' as $$
declare o public.calendar_occurrences; r public.calendar_reminders;
  v_now timestamptz:=coalesce(p_now,clock_timestamp()); v_started timestamptz:=clock_timestamp();
  v_delivered integer:=0; v_skipped integer:=0; v_checked integer:=0; n integer; alert_id bigint;
begin
  for o in select c.* from public.calendar_occurrences c where exists(select 1 from public.calendar_reminders j
    where j.occurrence_id=c.id and j.channel='hub' and j.status='scheduled' and j.scheduled_for<=v_now)
    order by c.starts_at,c.id limit least(20,greatest(1,coalesce(p_limit,10))) for update of c skip locked
  loop
    if clock_timestamp()-v_started>interval '3 seconds' then exit; end if;
    v_now:=coalesce(p_now,clock_timestamp());
    v_checked:=v_checked+1;
    perform id from public.calendar_reminders where occurrence_id=o.id and channel='hub' and status='scheduled' for update;
    update public.calendar_reminders set status='cancelled',scheduled_for=null,invalidated_at=v_now
      where occurrence_id=o.id and channel='hub' and status='scheduled' and (lead_minutes not in (60,10,0) or schedule_revision<>o.reminder_revision or o.status<>'scheduled'
        or not(user_id=o.organizer_id or user_id=any(o.attendee_ids)));
    get diagnostics n=row_count; v_skipped:=v_skipped+n;
    update public.calendar_reminders set status='skipped',invalidated_at=v_now
      where occurrence_id=o.id and channel='hub' and status='scheduled' and scheduled_for<v_now-interval '2 minutes';
    get diagnostics n=row_count; v_skipped:=v_skipped+n;
    for r in select distinct on (user_id) * from public.calendar_reminders
      where occurrence_id=o.id and channel='hub' and schedule_revision=o.reminder_revision and status='scheduled'
        and scheduled_for<=v_now and scheduled_for>=v_now-interval '2 minutes'
      order by user_id,scheduled_for desc,lead_minutes
    loop
      if clock_timestamp()-v_started>interval '3 seconds' then exit; end if;
      v_now:=coalesce(p_now,clock_timestamp());
      if r.scheduled_for<v_now-interval '2 minutes' then
        update public.calendar_reminders set status='skipped',invalidated_at=v_now where id=r.id;
        v_skipped:=v_skipped+1; continue;
      end if;
      if not public.calendar_reminder_account_active(r.user_id) then
        update public.calendar_reminders set status='cancelled',invalidated_at=v_now where id=r.id;
        v_skipped:=v_skipped+1; continue;
      end if;
      alert_id:=null;
      insert into public.hub_notifications(recipient_id,calendar_occurrence_id,calendar_revision,calendar_lead_minutes,created_at)
        select r.user_id,o.id,o.reminder_revision,r.lead_minutes,v_now
        where public.calendar_reminder_account_active(r.user_id)
        on conflict(recipient_id,calendar_occurrence_id,calendar_revision,calendar_lead_minutes) where calendar_occurrence_id is not null do nothing
        returning id into alert_id;
      if alert_id is not null then v_delivered:=v_delivered+1; end if;
      if alert_id is null and not exists(select 1 from public.hub_notifications where recipient_id=r.user_id
        and calendar_occurrence_id=o.id and calendar_revision=o.reminder_revision and calendar_lead_minutes=r.lead_minutes) then
        update public.calendar_reminders set status='cancelled',invalidated_at=v_now where id=r.id;
        v_skipped:=v_skipped+1; continue;
      end if;
      update public.calendar_reminders set status='sent',delivered_at=coalesce(delivered_at,v_now) where id=r.id;
      update public.calendar_reminders set status='skipped',invalidated_at=v_now
        where occurrence_id=o.id and user_id=r.user_id and channel='hub' and schedule_revision=o.reminder_revision
          and status='scheduled' and scheduled_for<=r.scheduled_for and id<>r.id;
      get diagnostics n=row_count; v_skipped:=v_skipped+n;
    end loop;
  end loop;
  return jsonb_build_object('delivered',v_delivered,'skipped',v_skipped,'checked',v_checked,'group_delivery','pending_private_groups');
end $$;
revoke all on function public.calendar_deliver_reminders(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.calendar_deliver_reminders(timestamptz,integer) to service_role;

-- Backfill schedules only: skip stages already past at installation. Never send
-- an alert from this migration. Keep reminder jobs inaccessible to browsers.
do $$ declare occurrence uuid; begin
  for occurrence in select id from public.calendar_occurrences where status='scheduled' and ends_at>statement_timestamp()
  loop perform public.calendar_plan_reminders(occurrence); end loop;
end $$;
revoke all on public.calendar_reminders from public,anon,authenticated;
comment on table public.calendar_reminders is 'Private durable in-app stages, per occurrence/time revision/recipient. Atomic delivery, 2-minute grace. Email is not implemented.';
notify pgrst,'reload schema';
commit;
