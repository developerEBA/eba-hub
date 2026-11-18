begin;

alter table public.client_conversation_messages
  add column request_id uuid not null default gen_random_uuid(),
  add constraint client_message_retry_key unique (client_id, sender_side, request_id);
grant insert (request_id) on public.client_conversation_messages to authenticated;

alter policy "Post to authorized client conversations" on public.client_conversation_messages
  with check (
    (sender_side = 'staff' and (select eba_private.client_directory_can_write()) and exists (
      select 1 from public.client_directory c where c.id = client_id
    )) or (sender_side = 'client' and eba_private.client_portal_has_access(client_id))
  );

create table public.client_message_reads (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message_id bigint not null references public.client_conversation_messages(id) on delete cascade,
  primary key (user_id, message_id)
);
create index client_message_reads_message_idx on public.client_message_reads(message_id);
alter table public.client_message_reads enable row level security;
revoke all on public.client_message_reads from public, anon, authenticated;
grant select, insert (message_id) on public.client_message_reads to authenticated;

create policy "Read own authorized client message receipts" on public.client_message_reads
  for select to authenticated using (
    user_id = (select auth.uid()) and exists (
      select 1 from public.client_conversation_messages m where m.id = message_id
    )
  );
create policy "Mark own incoming client messages read" on public.client_message_reads
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.client_conversation_messages m where m.id = message_id
      and m.sender_side = case when (select eba_private.hub_is_active()) then 'client' else 'staff' end
    )
  );

alter table public.hub_notifications
  add column client_message_id bigint references public.client_conversation_messages(id) on delete cascade,
  add constraint hub_notifications_recipient_client_message_key unique (recipient_id, client_message_id);
create index hub_notifications_client_message_idx on public.hub_notifications(client_message_id)
  where client_message_id is not null;

alter table public.hub_notifications drop constraint hub_notifications_check;
alter table public.hub_notifications add constraint hub_notifications_check check (
  (approval_id is not null and message_id is null and conversation_id is null and client_message_id is null)
  or (approval_id is null and message_id is not null and conversation_id is not null and client_message_id is null)
  or (approval_id is null and message_id is null and conversation_id is null and client_message_id is not null)
);

-- Preserve the internal Connect and approval policies, and add an Admin gate
-- specifically for the new notification type.
create policy "Only Admins can access client message alerts" on public.hub_notifications
  as restrictive for all to authenticated
  using (client_message_id is null or (select eba_private.client_directory_can_write()))
  with check (client_message_id is null or (select eba_private.client_directory_can_write()));

create function eba_private.notify_client_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.sender_side = 'client' then
    insert into public.hub_notifications (recipient_id, client_message_id)
    select m.user_id, new.id from public.staff_memberships m
    where m.role = 'admin' and m.status = 'active'
      and eba_private.connect_is_active(m.user_id)
    on conflict (recipient_id, client_message_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function eba_private.notify_client_message() from public, anon, authenticated;
create trigger notify_client_message after insert on public.client_conversation_messages
  for each row execute function eba_private.notify_client_message();

create function public.client_unread_message_count(p_client uuid)
returns bigint language sql stable security invoker set search_path = ''
as $$
  select count(*) from public.client_conversation_messages m
  where m.client_id = p_client
    and m.sender_side = case when (select eba_private.hub_is_active()) then 'client' else 'staff' end
    and not exists (select 1 from public.client_message_reads r where r.message_id = m.id);
$$;

create function public.mark_client_messages_read(p_client uuid, p_messages bigint[])
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if coalesce(cardinality(p_messages), 0) not between 1 and 50 then return; end if;
  insert into public.client_message_reads (message_id)
  select m.id from public.client_conversation_messages m
  where m.client_id = p_client and m.id = any(p_messages)
    and m.sender_side = case when (select eba_private.hub_is_active()) then 'client' else 'staff' end
  on conflict do nothing;

  if eba_private.client_directory_can_write() then
    update public.hub_notifications n set read_at = now()
    where n.read_at is null and n.client_message_id in (
      select m.id from public.client_conversation_messages m
      where m.client_id = p_client and m.id = any(p_messages)
    );
  end if;
end;
$$;
revoke all on function public.client_unread_message_count(uuid), public.mark_client_messages_read(uuid, bigint[])
  from public, anon, authenticated;
grant execute on function public.client_unread_message_count(uuid), public.mark_client_messages_read(uuid, bigint[])
  to authenticated;

commit;
