begin;

create table public.client_portal_invites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_directory(id),
  email text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '48 hours',
  used_at timestamptz,
  revoked_at timestamptz
);

create table public.client_portal_access (
  user_id uuid primary key references auth.users(id),
  client_id uuid not null references public.client_directory(id),
  email text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.client_portal_shares (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_directory(id),
  kind text not null check (kind in ('project', 'file')),
  project_id uuid references public.department_plans(id),
  object_path text unique,
  filename text,
  title text not null check (length(title) between 1 and 160),
  description text not null default '' check (length(description) <= 1500),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((kind = 'project' and project_id is not null and object_path is null and filename is null)
    or (kind = 'file' and project_id is null and object_path is not null and filename is not null))
);

create unique index client_portal_unique_project_share
  on public.client_portal_shares(client_id, project_id) where revoked_at is null and kind = 'project';
create index client_portal_invites_client_idx on public.client_portal_invites(client_id, created_at desc);
create index client_portal_access_client_idx on public.client_portal_access(client_id);
create index client_portal_shares_client_idx on public.client_portal_shares(client_id, created_at desc);

create table public.client_portal_audit (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.client_directory(id),
  actor_id uuid not null references auth.users(id),
  actor_email text,
  action text not null,
  target_id uuid not null,
  created_at timestamptz not null default now()
);
create index client_portal_audit_client_idx on public.client_portal_audit(client_id, id desc);

create function eba_private.client_portal_has_access(p_client uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.client_portal_access a
    join auth.users u on u.id = a.user_id
    where a.user_id = auth.uid() and a.client_id = p_client and a.revoked_at is null
      and u.email_confirmed_at is not null and lower(u.email) = a.email
      and not exists (select 1 from public.staff_memberships m where m.user_id = u.id)
  );
$$;
revoke all on function eba_private.client_portal_has_access(uuid) from public, anon, authenticated;
grant execute on function eba_private.client_portal_has_access(uuid) to authenticated;

alter table public.client_portal_invites enable row level security;
alter table public.client_portal_access enable row level security;
alter table public.client_portal_shares enable row level security;
alter table public.client_portal_audit enable row level security;
revoke all on public.client_portal_invites, public.client_portal_access, public.client_portal_shares,
  public.client_portal_audit from public, anon, authenticated;
grant select (id,client_id,email,created_at,expires_at,used_at,revoked_at) on public.client_portal_invites to authenticated;
grant select on public.client_portal_access, public.client_portal_audit to authenticated;
grant select (id,client_id,kind,object_path,filename,title,description,created_at,revoked_at)
  on public.client_portal_shares to authenticated;

create policy "Staff see client invitations" on public.client_portal_invites for select to authenticated
  using ((select eba_private.hub_is_active()));
create policy "Staff and account owners see permitted access" on public.client_portal_access for select to authenticated
  using ((select eba_private.hub_is_active())
    or (user_id = (select auth.uid()) and eba_private.client_portal_has_access(client_id)));
create policy "Staff see sharing history and clients see active shares" on public.client_portal_shares for select to authenticated
  using ((select eba_private.hub_is_active()) or (revoked_at is null and eba_private.client_portal_has_access(client_id)));
create policy "Staff see client portal audit" on public.client_portal_audit for select to authenticated
  using ((select eba_private.hub_is_active()));

create function public.current_client_portal_id()
returns uuid language sql stable security invoker set search_path = ''
as $$
  select a.client_id from public.client_portal_access a
  where a.user_id = (select auth.uid()) and eba_private.client_portal_has_access(a.client_id);
$$;
revoke all on function public.current_client_portal_id() from public, anon, authenticated;
grant execute on function public.current_client_portal_id() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-shared-files', 'client-shared-files', false, 750000,
  array['application/pdf', 'image/jpeg', 'image/png']);

create policy "Admins stage client files" on storage.objects for insert to authenticated
  with check (bucket_id = 'client-shared-files' and (select eba_private.client_directory_can_write())
    and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}$');
create policy "Read authorized active client files" on storage.objects for select to authenticated
  using (bucket_id = 'client-shared-files' and (
    (select eba_private.client_directory_can_write())
    or exists (
      select 1 from public.client_portal_shares s
      where s.object_path = storage.objects.name and s.revoked_at is null
        and eba_private.client_portal_has_access(s.client_id)
    )
  ));
create policy "Admins clean up staged client files" on storage.objects for delete to authenticated
  using (bucket_id = 'client-shared-files' and (select eba_private.client_directory_can_write())
    and not exists (select 1 from public.client_portal_shares s where s.object_path = storage.objects.name));

create function eba_private.manage_client_portal(p_client uuid, p_action text, p_data jsonb)
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
  if not exists (select 1 from public.client_directory where id = p_client) then return 'unavailable'; end if;

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

create function eba_private.accept_client_portal_invite(p_hash text)
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

create function public.manage_client_portal(p_client uuid, p_action text, p_data jsonb)
returns text language sql security invoker set search_path = ''
as $$ select eba_private.manage_client_portal(p_client,p_action,p_data); $$;

create function public.accept_client_portal_invite(p_hash text)
returns text language sql security invoker set search_path = ''
as $$ select eba_private.accept_client_portal_invite(p_hash); $$;

revoke all on function eba_private.manage_client_portal(uuid,text,jsonb), public.manage_client_portal(uuid,text,jsonb),
  eba_private.accept_client_portal_invite(text), public.accept_client_portal_invite(text) from public, anon, authenticated;
grant execute on function eba_private.manage_client_portal(uuid,text,jsonb), public.manage_client_portal(uuid,text,jsonb),
  eba_private.accept_client_portal_invite(text), public.accept_client_portal_invite(text) to authenticated;

commit;
