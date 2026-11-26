-- Convert department channels into explicitly typed, authorization-scoped rooms.
-- Populated legacy shared rooms are retained read-only for a snapshot of their
-- pre-migration eligible readers; new private rooms are created alongside them.
-- No room/message is deleted, relabeled confidential, or seeded with activity.
begin;

do $$
begin
  if to_regclass('public.staff_department_assignments') is null then
    raise exception 'Apply calendar_part1 (staff_department_assignments) before private department rooms';
  end if;
  if to_regclass('public.staff_access_profiles') is null then
    raise exception 'Apply staff_access before private department rooms';
  end if;
  if to_regclass('public.connect_messages') is null or to_regclass('public.connect_profiles') is null then
    raise exception 'Apply Connect migrations through connect_message_controls before private department rooms';
  end if;
end $$;

create table public.connect_legacy_room_readers (
  room_id uuid not null references public.connect_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (room_id,user_id)
);
alter table public.connect_legacy_room_readers enable row level security;
revoke all on public.connect_legacy_room_readers from public,anon,authenticated;

-- Preserve access to existing shared history only for people who could read it
-- at cutover. The current Connect gate admits active CEO/Admin accounts only.
insert into public.connect_legacy_room_readers(room_id,user_id)
select c.id,p.user_id
from public.connect_conversations c
join public.connect_profiles p on true
where c.id<>'00000000-0000-4000-8000-000000000001'::uuid
  and c.member_low is null and c.member_high is null
  and exists(select 1 from public.connect_messages m where m.conversation_id=c.id)
  and eba_private.connect_is_active(p.user_id)
on conflict do nothing;

alter table public.connect_conversations
  add column room_type text not null default 'dm',
  add column department text,
  add column archived_at timestamptz;

-- The existing fixed IDs map unambiguously to these departments in the shipped
-- Connect UI. Empty rooms are converted in place; populated rooms are archived.
update public.connect_conversations c set
  room_type=case
    when c.id='00000000-0000-4000-8000-000000000001'::uuid then 'general'
    when c.member_low is not null then 'dm'
    when c.id in ('00000000-0000-4000-8000-000000000002'::uuid,
                  '00000000-0000-4000-8000-000000000003'::uuid,
                  '00000000-0000-4000-8000-000000000004'::uuid,
                  '00000000-0000-4000-8000-000000000005'::uuid,
                  '00000000-0000-4000-8000-000000000006'::uuid)
      then case when exists(select 1 from public.connect_messages m where m.conversation_id=c.id)
                then 'legacy_shared' else 'department' end
    else 'legacy_shared'
  end,
  department=case c.id
    when '00000000-0000-4000-8000-000000000002'::uuid then 'graphics'
    when '00000000-0000-4000-8000-000000000003'::uuid then 'development'
    when '00000000-0000-4000-8000-000000000004'::uuid then 'communications'
    when '00000000-0000-4000-8000-000000000005'::uuid then 'events'
    when '00000000-0000-4000-8000-000000000006'::uuid then 'marketing'
    else null
  end,
  archived_at=case
    when c.member_low is null and c.member_high is null
      and c.id<>'00000000-0000-4000-8000-000000000001'::uuid
      and (c.id not in ('00000000-0000-4000-8000-000000000002'::uuid,
                        '00000000-0000-4000-8000-000000000003'::uuid,
                        '00000000-0000-4000-8000-000000000004'::uuid,
                        '00000000-0000-4000-8000-000000000005'::uuid,
                        '00000000-0000-4000-8000-000000000006'::uuid)
        or exists(select 1 from public.connect_messages m where m.conversation_id=c.id))
      then statement_timestamp()
    else null
  end;

alter table public.connect_conversations drop constraint if exists connect_conversations_check;
alter table public.connect_conversations add constraint connect_conversations_room_shape_check check (
  (room_type='general' and id='00000000-0000-4000-8000-000000000001'::uuid
    and member_low is null and member_high is null and department is null and archived_at is null)
  or (room_type='dm' and id<>'00000000-0000-4000-8000-000000000001'::uuid
    and member_low is not null and member_high is not null and member_low<member_high
    and department is null and archived_at is null)
  or (room_type='department' and id<>'00000000-0000-4000-8000-000000000001'::uuid
    and member_low is null and member_high is null
    and department in ('graphics','development','communications','events','marketing') and archived_at is null)
  or (room_type='legacy_shared' and id<>'00000000-0000-4000-8000-000000000001'::uuid
    and member_low is null and member_high is null and archived_at is not null
    and (department is null or department in ('graphics','development','communications','events','marketing')))
);
create unique index connect_department_room_unique on public.connect_conversations(department)
  where room_type='department';

insert into public.connect_conversations(room_type,department)
select 'department',d.department from (values
  ('graphics'),('development'),('communications'),('events'),('marketing')
) d(department)
where not exists(select 1 from public.connect_conversations c
  where c.room_type='department' and c.department=d.department);

create or replace function eba_private.connect_has_joined(person uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select eba_private.connect_is_active(person)
    and exists(select 1 from public.connect_profiles where user_id=person);
$$;

create or replace function eba_private.connect_user_can_read(person uuid, room uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.connect_conversations c
    join public.staff_memberships m on m.user_id=person and m.status='active'
    join auth.users u on u.id=person and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
    where c.id=room and eba_private.connect_has_joined(person)
      and case c.room_type
        when 'general' then true
        when 'dm' then person in (c.member_low,c.member_high)
        when 'department' then
          (m.role in ('ceo','admin') or (m.role in ('staff','hod') and exists(
            select 1 from public.staff_department_assignments a
            where a.user_id=person and a.department=c.department)))
        when 'legacy_shared' then exists(
          select 1 from public.connect_legacy_room_readers r
          where r.room_id=c.id and r.user_id=person)
        else false
      end
  );
$$;

create or replace function eba_private.connect_can_read(room uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select eba_private.connect_user_can_read(auth.uid(),room); $$;

create or replace function eba_private.connect_can_write(room uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select eba_private.connect_can_read(room) and exists(
    select 1 from public.connect_conversations c where c.id=room and c.archived_at is null
      and c.room_type in ('general','dm','department'));
$$;

create function public.connect_department_members(room uuid)
returns table(user_id uuid,display_name text,avatar_url text)
language sql stable security definer set search_path = ''
as $$
  select distinct m.user_id,
    coalesce(nullif(btrim(ap.name),''),nullif(btrim(cp.display_name),''),split_part(u.email,'@',1)) as display_name,
    cp.avatar_url
  from public.connect_conversations c
  join public.staff_department_assignments a on a.department=c.department
  join public.staff_memberships m on m.user_id=a.user_id and m.status='active'
    and m.role in ('staff','hod','ceo','admin')
  join auth.users u on u.id=m.user_id and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
  left join public.staff_access_profiles ap on ap.user_id=m.user_id
  left join public.connect_profiles cp on cp.user_id=m.user_id
  where c.id=room and c.room_type='department'
    and eba_private.connect_can_read(room)
  union
  select distinct m.user_id,
    coalesce(nullif(btrim(ap.name),''),nullif(btrim(cp.display_name),''),split_part(u.email,'@',1)),
    cp.avatar_url
  from public.connect_conversations c
  join public.staff_memberships m on m.role in ('ceo','admin') and m.status='active'
  join auth.users u on u.id=m.user_id and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
  left join public.staff_access_profiles ap on ap.user_id=m.user_id
  left join public.connect_profiles cp on cp.user_id=m.user_id
  where c.id=room and c.room_type='department'
    and eba_private.connect_can_read(room)
    and eba_private.connect_is_active(m.user_id)
  order by display_name,user_id;
$$;

revoke all on function eba_private.connect_has_joined(uuid),
  eba_private.connect_user_can_read(uuid,uuid),eba_private.connect_can_read(uuid),
  eba_private.connect_can_write(uuid),public.connect_department_members(uuid)
  from public,anon,authenticated;
grant execute on function eba_private.connect_has_joined(uuid),
  eba_private.connect_can_read(uuid),eba_private.connect_can_write(uuid) to authenticated;
grant execute on function public.connect_department_members(uuid) to authenticated;

drop policy if exists "Joined members read active profiles" on public.connect_profiles;
create policy "Joined members read active profiles" on public.connect_profiles for select to authenticated
  using ((select eba_private.connect_has_joined(auth.uid())) and eba_private.connect_has_joined(user_id));

drop policy if exists "Joined members read General and their own DMs" on public.connect_conversations;
create policy "Authorized members read typed Connect rooms" on public.connect_conversations for select to authenticated
  using (eba_private.connect_can_read(id));

drop policy if exists "Joined members read messages in visible conversations" on public.connect_messages;
create policy "Authorized members read visible Connect messages" on public.connect_messages for select to authenticated
  using (eba_private.connect_can_read(conversation_id));

drop policy if exists "Joined members send messages as themselves" on public.connect_messages;
create policy "Authorized members send messages as themselves" on public.connect_messages for insert to authenticated
  with check (sender_id=(select auth.uid()) and eba_private.connect_can_write(conversation_id));

create or replace function eba_private.connect_open_dm(recipient uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare caller uuid:=auth.uid(); room uuid;
begin
  if recipient is null or caller is null or caller=recipient
    or not eba_private.connect_has_joined(caller) or not eba_private.connect_has_joined(recipient) then
    raise insufficient_privilege using message='Conversation unavailable';
  end if;
  insert into public.connect_conversations(member_low,member_high,room_type)
    values(least(caller,recipient),greatest(caller,recipient),'dm')
    on conflict(member_low,member_high) do update set member_low=excluded.member_low
    returning id into room;
  return room;
end;
$$;

create or replace function eba_private.notify_connect_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.hub_notifications(recipient_id,message_id,conversation_id)
  select p.user_id,new.id,new.conversation_id
  from public.connect_profiles p
  where p.user_id<>new.sender_id and eba_private.connect_user_can_read(p.user_id,new.conversation_id)
  on conflict(recipient_id,message_id) do nothing;
  return new;
end;
$$;

create or replace function eba_private.notify_connect_mentions()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind<>'text' or new.deleted_at is not null then return new; end if;
  insert into public.hub_notifications as existing(recipient_id,message_id,conversation_id,is_mention)
  select distinct member.user_id,new.id,new.conversation_id,true
  from regexp_matches(new.body,'@\{([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\}','gi') as token(match)
  join public.connect_profiles member on member.user_id=token.match[1]::uuid
  where member.user_id<>new.sender_id and eba_private.connect_user_can_read(member.user_id,new.conversation_id)
  on conflict(recipient_id,message_id) do update set is_mention=true,read_at=null where not existing.is_mention;
  return new;
end;
$$;

create or replace function eba_private.connect_change_message(message bigint,operation text,replacement text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if operation='edit' then
    if replacement is null or length(btrim(replacement,E' \t\r\n')) not between 1 and 4000 or length(replacement)>4000 then return false; end if;
    update public.connect_messages m set body=replacement,edited_at=statement_timestamp()
    where m.id=message and m.sender_id=auth.uid() and m.kind='text' and m.deleted_at is null
      and eba_private.connect_can_write(m.conversation_id);
    return found;
  elsif operation='delete' then
    update public.connect_messages m set kind='text',body='Message deleted',deleted_at=statement_timestamp(),
      audio_path=null,attachment_path=null,attachment_name=null,attachment_size=null,attachment_mime=null,attachment_caption=null
    where m.id=message and m.sender_id=auth.uid() and m.deleted_at is null
      and eba_private.connect_can_write(m.conversation_id);
    if not found then return false; end if;
    update public.hub_notifications n set read_at=statement_timestamp() where n.message_id=message and n.read_at is null;
    return true;
  end if;
  return false;
end;
$$;

create or replace function eba_private.connect_read_chat(room uuid,through_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not eba_private.connect_can_read(room) then raise insufficient_privilege using message='Conversation unavailable'; end if;
  insert into public.connect_message_reads(user_id,message_id)
    select auth.uid(),m.id from public.connect_messages m
    where m.conversation_id=room and m.id<=through_id and m.sender_id<>auth.uid() on conflict do nothing;
  update public.hub_notifications set read_at=statement_timestamp()
    where recipient_id=auth.uid() and conversation_id=room and message_id<=through_id and read_at is null;
end;
$$;

create or replace function public.connect_unread_counts()
returns table(conversation_id uuid,unread_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select m.conversation_id,count(*) from public.connect_messages m
  join public.connect_profiles p on p.user_id=(select auth.uid())
  left join public.connect_message_reads r on r.message_id=m.id and r.user_id=p.user_id
  where eba_private.connect_can_read(m.conversation_id) and m.sender_id<>p.user_id
    and m.sent_at>=p.first_signed_in_at and r.message_id is null and m.deleted_at is null
  group by m.conversation_id;
$$;

-- Mention/read/notification rows are scoped by their referenced room on every request.
drop policy if exists "Read own authorized alerts" on public.hub_notifications;
create policy "Read own authorized alerts" on public.hub_notifications for select to authenticated
  using (recipient_id=(select auth.uid()) and (select eba_private.hub_is_active())
    and (conversation_id is null or eba_private.connect_can_read(conversation_id)));
drop policy if exists "Mark own authorized alerts read" on public.hub_notifications;
create policy "Mark own authorized alerts read" on public.hub_notifications for update to authenticated
  using (recipient_id=(select auth.uid()) and (select eba_private.hub_is_active())
    and (conversation_id is null or eba_private.connect_can_read(conversation_id)))
  with check (recipient_id=(select auth.uid()) and (select eba_private.hub_is_active()) and read_at is not null
    and (conversation_id is null or eba_private.connect_can_read(conversation_id)));
drop policy if exists "Read own chat receipts" on public.connect_message_reads;
create policy "Read own authorized chat receipts" on public.connect_message_reads for select to authenticated
  using (user_id=(select auth.uid()) and (select eba_private.hub_is_active()) and exists(
    select 1 from public.connect_messages m where m.id=message_id and eba_private.connect_can_read(m.conversation_id)));

drop policy if exists "Participants stage their own voice files" on storage.objects;
create policy "Authorized members stage their own voice files" on storage.objects for insert to authenticated
  with check (bucket_id='connect-voice' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
    and split_part(name,'/',2)=(select auth.uid())::text
    and eba_private.connect_can_write(split_part(name,'/',1)::uuid));
drop policy if exists "Participants read linked voice files or their own staged files" on storage.objects;
create policy "Authorized members read linked voice files or own staged files" on storage.objects for select to authenticated
  using (bucket_id='connect-voice' and exists(
    select 1 from public.connect_conversations c where c.id::text=split_part(storage.objects.name,'/',1)
      and eba_private.connect_can_read(c.id)
      and (split_part(storage.objects.name,'/',2)=(select auth.uid())::text
        or exists(select 1 from public.connect_messages m where m.audio_path=storage.objects.name
          and m.conversation_id=c.id and eba_private.connect_can_read(c.id))
        or not exists(select 1 from public.connect_messages m where m.audio_path=storage.objects.name))));
drop policy if exists "Uploaders delete only unlinked voice files" on storage.objects;
create policy "Authorized uploaders delete only unlinked voice files" on storage.objects for delete to authenticated
  using (bucket_id='connect-voice'
    and split_part(name,'/',2)=(select auth.uid())::text
    and eba_private.connect_can_write(split_part(name,'/',1)::uuid)
    and not exists(select 1 from public.connect_messages m where m.audio_path=storage.objects.name));
drop policy if exists "Participants read linked Connect attachments" on storage.objects;
create policy "Authorized members read linked Connect attachments" on storage.objects for select to authenticated
  using (bucket_id='connect-attachments' and exists(
    select 1 from public.connect_messages m where m.attachment_path=storage.objects.name
      and eba_private.connect_can_read(m.conversation_id)));

create or replace function eba_private.validate_connect_voice()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not eba_private.connect_user_can_read(new.sender_id,new.conversation_id) or not exists(
    select 1 from storage.objects file where file.bucket_id='connect-voice' and file.name=new.audio_path
      and split_part(file.name,'/',1)=new.conversation_id::text and split_part(file.name,'/',2)=new.sender_id::text) then
    raise check_violation using message='Voice upload unavailable';
  end if;
  return new;
end;
$$;
create or replace function eba_private.validate_connect_attachment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not eba_private.connect_user_can_read(new.sender_id,new.conversation_id) or not exists(
    select 1 from storage.objects file where file.bucket_id='connect-attachments' and file.name=new.attachment_path
      and split_part(file.name,'/',1)=new.conversation_id::text and split_part(file.name,'/',2)=new.sender_id::text
      and file.metadata->>'mimetype'=new.attachment_mime and file.metadata->>'size'=new.attachment_size::text) then
    raise check_violation using message='Attachment upload unavailable';
  end if;
  return new;
end;
$$;

comment on table public.connect_legacy_room_readers is
  'Snapshot of active pre-cutover Connect readers for read-only historical shared-room visibility; never grants new department access.';
comment on column public.connect_conversations.room_type is
  'Explicit room discriminator. Department privacy is checked against active staff roles and staff_department_assignments, never inferred from NULL members.';

notify pgrst,'reload schema';
commit;
