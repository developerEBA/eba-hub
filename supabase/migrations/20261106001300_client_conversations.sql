begin;

alter table public.client_directory add column deleted_at timestamptz;
alter table public.client_directory add column deleted_by uuid references auth.users(id) on delete set null;

alter policy "Active executives read the client directory" on public.client_directory
  using (deleted_at is null and (select eba_private.hub_is_active()));
alter policy "Active Admins edit clients" on public.client_directory
  using (deleted_at is null and (select eba_private.client_directory_can_write()))
  with check (deleted_at is null and (select eba_private.client_directory_can_write()));

create function eba_private.delete_client_record(p_client uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if not eba_private.client_directory_can_write() then raise insufficient_privilege; end if;
  update public.client_directory set deleted_at = now(), deleted_by = auth.uid()
    where id = p_client and deleted_at is null;
  return found;
end;
$$;

create function public.delete_client_record(p_client uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select eba_private.delete_client_record(p_client); $$;

revoke all on function eba_private.delete_client_record(uuid), public.delete_client_record(uuid) from public, anon, authenticated;
grant execute on function eba_private.delete_client_record(uuid), public.delete_client_record(uuid) to authenticated;

create or replace function eba_private.client_portal_has_access(p_client uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.client_portal_access a
    join public.client_directory c on c.id = a.client_id and c.deleted_at is null
    join auth.users u on u.id = a.user_id
    where a.user_id = auth.uid() and a.client_id = p_client and a.revoked_at is null
      and u.email_confirmed_at is not null and lower(u.email) = a.email
      and not exists (select 1 from public.staff_memberships m where m.user_id = u.id)
  );
$$;

create or replace function eba_private.manage_client_portal(p_client uuid, p_action text, p_data jsonb)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  target uuid;
  account uuid;
  address text := lower(btrim(p_data ->> 'email'));
  title text := btrim(p_data ->> 'title');
  description text := coalesce(btrim(p_data ->> 'description'), '');
  object_name text := p_data ->> 'object_path';
  filename text := p_data ->> 'filename';
  existing_client uuid;
begin
  if not eba_private.client_directory_can_write() then raise insufficient_privilege; end if;
  perform 1 from public.client_directory where id = p_client and deleted_at is null for share;
  if not found then return 'unavailable'; end if;

  if p_action in ('invite_created', 'access_granted') then
    if address is null or length(address) > 254 or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      return 'invalid';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(address, 6174));
  end if;

  case p_action
    when 'invite_created' then
      if coalesce(p_data ->> 'token_hash', '') !~ '^[a-f0-9]{64}$' then return 'invalid'; end if;
      insert into public.client_portal_invites (client_id,email,token_hash)
      values (p_client,address,p_data ->> 'token_hash') returning id into target;
    when 'invite_revoked' then
      update public.client_portal_invites set revoked_at = now()
      where id = (p_data ->> 'id')::uuid and client_id = p_client
        and used_at is null and revoked_at is null returning id into target;
    when 'access_granted' then
      select u.id into account from auth.users u
      where lower(u.email) = address and u.email_confirmed_at is not null
        and not exists (select 1 from public.staff_memberships m where m.user_id = u.id);
      if account is null then return 'account-unavailable'; end if;
      select client_id into existing_client from public.client_portal_access where user_id = account;
      if existing_client is distinct from p_client and existing_client is not null then return 'account-unavailable'; end if;
      -- A grant can restore an account already bound by an invitation. New accounts must redeem an invite.
      update public.client_portal_access set revoked_at = null, granted_at = now()
      where user_id = account and client_id = p_client and email = address and revoked_at is not null
      returning user_id into target;
    when 'access_revoked' then
      select email into address from public.client_portal_access
      where user_id = (p_data ->> 'id')::uuid and client_id = p_client;
      if address is null then return 'unavailable'; end if;
      perform pg_advisory_xact_lock(hashtextextended(address, 6174));
      update public.client_portal_access set revoked_at = now()
      where user_id = (p_data ->> 'id')::uuid and client_id = p_client and revoked_at is null
      returning user_id into target;
      if target is not null then
        with revoked as (
          update public.client_portal_invites set revoked_at = now()
          where client_id = p_client and email = address and used_at is null and revoked_at is null
          returning id
        )
        insert into public.client_portal_audit(client_id,actor_id,actor_email,action,target_id)
        select p_client,auth.uid(),auth.jwt() ->> 'email','invite_revoked',id from revoked;
      end if;
    when 'project_shared', 'file_shared' then
      if title is null or length(title) not between 1 and 160 or length(description) > 1500 then return 'invalid'; end if;
      if p_action = 'project_shared' then
        insert into public.client_portal_shares (client_id,kind,project_id,title,description)
        select p_client,'project',id,title,description from public.department_plans
        where id = (p_data ->> 'id')::uuid and status = 'submitted'
        on conflict do nothing returning id into target;
      else
        if filename is null or length(filename) not between 1 and 180 or object_name is null
          or split_part(object_name,'/',1) <> p_client::text then return 'invalid'; end if;
        insert into public.client_portal_shares (client_id,kind,object_path,filename,title,description)
        select p_client,'file',name,filename,title,description from storage.objects
        where bucket_id = 'client-shared-files' and name = object_name
        on conflict do nothing returning id into target;
      end if;
    when 'share_revoked' then
      update public.client_portal_shares set revoked_at = now()
      where id = (p_data ->> 'id')::uuid and client_id = p_client and revoked_at is null returning id into target;
    else return 'invalid';
  end case;

  if target is null then return 'unavailable'; end if;
  insert into public.client_portal_audit (client_id,actor_id,actor_email,action,target_id)
  values (p_client,auth.uid(),auth.jwt() ->> 'email',p_action,target);
  return 'ok';
end;
$$;

create or replace function eba_private.accept_client_portal_invite(p_hash text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  invite public.client_portal_invites%rowtype;
  account uuid := auth.uid();
  address text;
  current_access public.client_portal_access%rowtype;
begin
  if account is null or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' then return 'invalid'; end if;
  select lower(u.email) into address from auth.users u
    where u.id = account and u.email_confirmed_at is not null
      and not exists (select 1 from public.staff_memberships m where m.user_id = u.id);
  if address is null then return 'invalid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(address, 6174));
  select * into invite from public.client_portal_invites
    where token_hash = p_hash and email = address for update;
  if not found then return 'invalid'; end if;
  perform 1 from public.client_directory where id = invite.client_id and deleted_at is null for share;
  if not found then return 'revoked'; end if;
  if invite.revoked_at is not null then return 'revoked'; end if;
  if invite.used_at is not null then return 'used'; end if;
  if invite.expires_at <= now() then return 'expired'; end if;

  select * into current_access from public.client_portal_access where user_id = account for update;
  if found and (current_access.client_id <> invite.client_id or current_access.email <> address) then return 'invalid'; end if;

  insert into public.client_portal_access as existing (user_id,client_id,email)
  values (account,invite.client_id,address)
  on conflict (user_id) do update set revoked_at = null, granted_at = now()
    where existing.client_id = excluded.client_id and existing.email = excluded.email and existing.revoked_at is not null;

  if not eba_private.client_portal_has_access(invite.client_id) then return 'invalid'; end if;

  update public.client_portal_invites set used_at = now() where id = invite.id;
  insert into public.client_portal_audit (client_id,actor_id,actor_email,action,target_id)
  values (invite.client_id,account,address,'invite_accepted',invite.id);
  return 'ok';
end;
$$;


create table public.client_conversation_messages (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.client_directory(id),
  sender_side text not null check (sender_side in ('staff', 'client')),
  body text not null check (length(body) <= 2000 and body ~ '[^[:space:]]'),
  created_at timestamptz not null default now()
);
create index client_conversation_history_idx on public.client_conversation_messages (client_id, id desc);

alter table public.client_conversation_messages enable row level security;
revoke all on public.client_conversation_messages from public, anon, authenticated;
grant select, insert (client_id, sender_side, body) on public.client_conversation_messages to authenticated;

create policy "Read active client conversations" on public.client_conversation_messages
  for select to authenticated using (
    ((select eba_private.hub_is_active()) and exists (
      select 1 from public.client_directory c where c.id = client_id
    )) or eba_private.client_portal_has_access(client_id)
  );

create policy "Post to authorized client conversations" on public.client_conversation_messages
  for insert to authenticated with check (
    (sender_side = 'staff' and (select eba_private.hub_is_active()) and exists (
      select 1 from public.client_directory c where c.id = client_id
    )) or (sender_side = 'client' and eba_private.client_portal_has_access(client_id))
  );

commit;
