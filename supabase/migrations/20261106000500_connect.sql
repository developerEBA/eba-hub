begin;

create schema if not exists eba_private;
revoke all on schema eba_private from public, anon;
grant usage on schema eba_private to authenticated;

create table public.connect_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  first_signed_in_at timestamptz not null default now()
);

create table public.connect_conversations (
  id uuid primary key default gen_random_uuid(),
  member_low uuid references public.connect_profiles(user_id) on delete cascade,
  member_high uuid references public.connect_profiles(user_id) on delete cascade,
  unique (member_low, member_high),
  check (
    (id = '00000000-0000-4000-8000-000000000001' and member_low is null and member_high is null)
    or (id <> '00000000-0000-4000-8000-000000000001' and member_low is not null
        and member_high is not null and member_low < member_high)
  )
);

insert into public.connect_conversations (id) values ('00000000-0000-4000-8000-000000000001');
create index connect_conversations_member_high_idx on public.connect_conversations(member_high);

create table public.connect_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.connect_profiles(user_id) on delete cascade,
  body text not null check (length(btrim(body, E' \t\r\n')) between 1 and 4000 and length(body) <= 4000),
  sent_at timestamptz not null default now()
);

create index connect_messages_conversation_idx on public.connect_messages(conversation_id, id desc);

-- The role gate mirrors the current Hub rollout. Expand it with the future staff rollout.
create function eba_private.connect_is_active(person uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_memberships m
    join auth.users u on u.id = m.user_id
    where m.user_id = person and m.status = 'active' and m.role in ('ceo', 'admin')
      and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
  );
$$;

create function eba_private.connect_has_joined(person uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select eba_private.connect_is_active(person)
    and exists (select 1 from public.connect_profiles where user_id = person);
$$;

create function eba_private.connect_can_read(room uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select eba_private.connect_has_joined(auth.uid())
    and exists (
      select 1 from public.connect_conversations c
      where c.id = room and (c.member_low is null or auth.uid() in (c.member_low, c.member_high))
    );
$$;

create function eba_private.connect_open_dm(recipient uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  room uuid;
begin
  if recipient is null or caller is null or caller = recipient
    or not eba_private.connect_has_joined(caller)
    or not eba_private.connect_has_joined(recipient) then
    raise insufficient_privilege using message = 'Conversation unavailable';
  end if;

  insert into public.connect_conversations (member_low, member_high)
  values (least(caller, recipient), greatest(caller, recipient))
  on conflict (member_low, member_high) do update set member_low = excluded.member_low
  returning id into room;
  return room;
end;
$$;

create function public.connect_open_dm(recipient uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select eba_private.connect_open_dm(recipient); $$;

-- Only the Hub server can call this after its sign-in authorization succeeds.
create function eba_private.connect_record_sign_in(person uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.connect_profiles (user_id, display_name, avatar_url)
  select id,
    left(coalesce(nullif(btrim(raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(raw_user_meta_data ->> 'name'), ''), split_part(email, '@', 1)), 120),
    case when raw_user_meta_data ->> 'avatar_url' ~ '^https://[^[:space:]]+$'
      then left(raw_user_meta_data ->> 'avatar_url', 2048) end
  from auth.users
  where id = person and eba_private.connect_is_active(person)
  on conflict (user_id) do nothing;
$$;

create function public.connect_record_sign_in(person uuid)
returns void language sql security invoker set search_path = ''
as $$ select eba_private.connect_record_sign_in(person); $$;

revoke all on function eba_private.connect_is_active(uuid), eba_private.connect_has_joined(uuid),
  eba_private.connect_can_read(uuid), eba_private.connect_open_dm(uuid),
  eba_private.connect_record_sign_in(uuid), public.connect_open_dm(uuid),
  public.connect_record_sign_in(uuid) from public, anon, authenticated;
grant usage on schema eba_private to service_role;
grant execute on function eba_private.connect_record_sign_in(uuid), public.connect_record_sign_in(uuid) to service_role;
grant execute on function eba_private.connect_has_joined(uuid), eba_private.connect_can_read(uuid),
  eba_private.connect_open_dm(uuid), public.connect_open_dm(uuid) to authenticated;

alter table public.connect_profiles enable row level security;
alter table public.connect_conversations enable row level security;
alter table public.connect_messages enable row level security;
revoke all on public.connect_profiles, public.connect_conversations, public.connect_messages
  from public, anon, authenticated;
grant select on public.connect_profiles, public.connect_conversations, public.connect_messages to authenticated;
grant insert (conversation_id, body) on public.connect_messages to authenticated;
grant usage on sequence public.connect_messages_id_seq to authenticated;

create policy "Joined members read active profiles"
  on public.connect_profiles for select to authenticated
  using ((select eba_private.connect_has_joined(auth.uid())) and eba_private.connect_has_joined(user_id));

create policy "Joined members read General and their own DMs"
  on public.connect_conversations for select to authenticated
  using (eba_private.connect_can_read(id));

create policy "Joined members read messages in visible conversations"
  on public.connect_messages for select to authenticated
  using (eba_private.connect_can_read(conversation_id));

create policy "Joined members send messages as themselves"
  on public.connect_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and eba_private.connect_can_read(conversation_id)
    and exists (
      select 1 from public.connect_conversations c
      where c.id = conversation_id and (c.member_low is null
        or (eba_private.connect_has_joined(c.member_low) and eba_private.connect_has_joined(c.member_high)))
    )
  );

alter publication supabase_realtime add table public.connect_messages;

commit;
