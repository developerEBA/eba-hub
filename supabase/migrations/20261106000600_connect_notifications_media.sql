begin;

alter table public.connect_messages
  add column kind text not null default 'text',
  add column audio_path text unique,
  add column client_id uuid not null default gen_random_uuid(),
  add constraint connect_message_retry_key unique (sender_id, client_id),
  add constraint connect_message_payload check (
    (kind = 'text' and audio_path is null)
    or (kind = 'sticker' and audio_path is null and body in ('celebrate', 'thanks', 'great-work', 'team'))
    or (kind = 'voice' and body = 'Voice note' and audio_path is not null
      and audio_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$')
  );
grant insert (kind, audio_path, client_id) on public.connect_messages to authenticated;

create table public.hub_notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  approval_id uuid references public.approval_requests(id) on delete cascade,
  message_id bigint references public.connect_messages(id) on delete cascade,
  conversation_id uuid references public.connect_conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (
    (approval_id is not null and message_id is null and conversation_id is null)
    or (approval_id is null and message_id is not null and conversation_id is not null)
  ),
  unique (recipient_id, approval_id),
  unique (recipient_id, message_id)
);
create index hub_notifications_inbox_idx on public.hub_notifications (recipient_id, id desc);
create index hub_notifications_unread_idx on public.hub_notifications (recipient_id) where read_at is null;

create table public.connect_message_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id bigint not null references public.connect_messages(id) on delete cascade,
  primary key (user_id, message_id)
);

alter table public.hub_notifications enable row level security;
alter table public.connect_message_reads enable row level security;
revoke all on public.hub_notifications, public.connect_message_reads from public, anon, authenticated;
grant select on public.hub_notifications, public.connect_message_reads to authenticated;
grant update (read_at) on public.hub_notifications to authenticated;

create function eba_private.hub_is_active()
returns boolean language sql stable security definer set search_path = ''
as $$ select eba_private.connect_is_active(auth.uid()); $$;
revoke all on function eba_private.hub_is_active() from public, anon, authenticated;
grant execute on function eba_private.hub_is_active() to authenticated;

create policy "Read own authorized alerts" on public.hub_notifications for select to authenticated
  using (
    recipient_id = (select auth.uid()) and (select eba_private.hub_is_active())
    and (conversation_id is null or eba_private.connect_can_read(conversation_id))
  );
create policy "Mark own authorized alerts read" on public.hub_notifications for update to authenticated
  using (
    recipient_id = (select auth.uid()) and (select eba_private.hub_is_active())
    and (conversation_id is null or eba_private.connect_can_read(conversation_id))
  )
  with check (
    recipient_id = (select auth.uid()) and (select eba_private.hub_is_active()) and read_at is not null
    and (conversation_id is null or eba_private.connect_can_read(conversation_id))
  );
create policy "Read own chat receipts" on public.connect_message_reads for select to authenticated
  using (user_id = (select auth.uid()) and (select eba_private.hub_is_active()));

create function eba_private.notify_pending_approval()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'pending' then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'pending' then return new; end if;
  end if;

  insert into public.hub_notifications (recipient_id, approval_id)
  select m.user_id, new.id from public.staff_memberships m
  where m.status = 'active' and m.role in ('ceo', 'admin')
    and eba_private.connect_is_active(m.user_id)
  on conflict (recipient_id, approval_id) do nothing;
  return new;
end;
$$;

create trigger notify_pending_approval
after insert or update of status on public.approval_requests
for each row execute function eba_private.notify_pending_approval();

create function eba_private.notify_connect_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.hub_notifications (recipient_id, message_id, conversation_id)
  select p.user_id, new.id, new.conversation_id
  from public.connect_conversations c
  join public.connect_profiles p on c.member_low is null or p.user_id in (c.member_low, c.member_high)
  where c.id = new.conversation_id and p.user_id <> new.sender_id
    and eba_private.connect_is_active(p.user_id)
  on conflict (recipient_id, message_id) do nothing;
  return new;
end;
$$;

create trigger notify_connect_message
after insert on public.connect_messages
for each row execute function eba_private.notify_connect_message();

create function public.connect_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select m.conversation_id, count(*)
  from public.connect_messages m
  join public.connect_profiles p on p.user_id = (select auth.uid())
  left join public.connect_message_reads r on r.message_id = m.id and r.user_id = p.user_id
  where m.sender_id <> p.user_id and m.sent_at >= p.first_signed_in_at and r.message_id is null
  group by m.conversation_id;
$$;

create function eba_private.connect_read_chat(room uuid, through_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not eba_private.connect_can_read(room) then
    raise insufficient_privilege using message = 'Conversation unavailable';
  end if;

  insert into public.connect_message_reads (user_id, message_id)
  select auth.uid(), m.id from public.connect_messages m
  where m.conversation_id = room and m.id <= through_id and m.sender_id <> auth.uid()
  on conflict do nothing;

  update public.hub_notifications
  set read_at = statement_timestamp()
  where recipient_id = auth.uid() and conversation_id = room
    and message_id <= through_id and read_at is null;
end;
$$;

create function public.connect_read_chat(room uuid, through_id bigint)
returns void language sql security invoker set search_path = ''
as $$ select eba_private.connect_read_chat(room, through_id); $$;

revoke all on function eba_private.notify_pending_approval(), eba_private.notify_connect_message(),
  public.connect_unread_counts(), eba_private.connect_read_chat(uuid, bigint),
  public.connect_read_chat(uuid, bigint) from public, anon, authenticated;
grant execute on function public.connect_unread_counts(), eba_private.connect_read_chat(uuid, bigint),
  public.connect_read_chat(uuid, bigint) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('connect-voice', 'connect-voice', false, 750000,
  array['audio/webm', 'audio/ogg', 'audio/mp4']);

create policy "Participants stage their own voice files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'connect-voice'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and exists (select 1 from public.connect_conversations c where c.id::text = split_part(name, '/', 1))
  );
create policy "Participants read linked voice files or their own staged files" on storage.objects for select to authenticated
  using (
    bucket_id = 'connect-voice'
    and exists (select 1 from public.connect_conversations c where c.id::text = split_part(name, '/', 1))
    and (split_part(name, '/', 2) = (select auth.uid())::text
      or exists (select 1 from public.connect_messages m where m.audio_path = storage.objects.name))
  );
create policy "Uploaders delete only unlinked voice files" on storage.objects for delete to authenticated
  using (
    bucket_id = 'connect-voice'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and exists (select 1 from public.connect_conversations c where c.id::text = split_part(name, '/', 1))
    and not exists (select 1 from public.connect_messages m where m.audio_path = storage.objects.name)
  );

create function eba_private.validate_connect_voice()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from storage.objects file
    where file.bucket_id = 'connect-voice' and file.name = new.audio_path
      and split_part(file.name, '/', 1) = new.conversation_id::text
      and split_part(file.name, '/', 2) = new.sender_id::text
  ) then
    raise check_violation using message = 'Voice upload unavailable';
  end if;
  return new;
end;
$$;

revoke all on function eba_private.validate_connect_voice() from public, anon, authenticated;
create trigger validate_connect_voice before insert on public.connect_messages
  for each row when (new.kind = 'voice') execute function eba_private.validate_connect_voice();

alter publication supabase_realtime add table public.hub_notifications;

commit;
