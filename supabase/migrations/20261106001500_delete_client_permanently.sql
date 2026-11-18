begin;

create table eba_private.client_deletion_audit (
  client_id uuid primary key,
  deleted_by uuid not null,
  deleted_at timestamptz not null default now()
);
revoke all on eba_private.client_deletion_audit from public, anon, authenticated;

create table public.client_file_cleanup (
  object_path text primary key,
  client_id uuid not null references eba_private.client_deletion_audit(client_id)
);
alter table public.client_file_cleanup enable row level security;
revoke all on public.client_file_cleanup from public, anon, authenticated;
grant select on public.client_file_cleanup to authenticated;
create policy "Admins read client file cleanup" on public.client_file_cleanup for select to authenticated
  using ((select eba_private.client_directory_can_write()));
create index client_file_cleanup_client_idx on public.client_file_cleanup(client_id);

-- The private upload namespace belongs to the directory record. A deleted
-- directory ID cannot be used to upload a replacement at a queued path.
create function eba_private.can_stage_client_file(p_directory text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if not eba_private.client_directory_can_write() then return false; end if;
  perform 1 from public.client_directory
  where id = p_directory::uuid and deleted_at is null for key share;
  return found;
exception when invalid_text_representation then
  return false;
end;
$$;
revoke all on function eba_private.can_stage_client_file(text) from public, anon, authenticated;
grant execute on function eba_private.can_stage_client_file(text) to authenticated;

alter policy "Admins stage client files" on storage.objects
  with check (
    bucket_id = 'client-shared-files'
    and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}$'
    and eba_private.can_stage_client_file(split_part(name, '/', 1))
  );

create or replace function eba_private.delete_client_record(p_client uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if not eba_private.client_directory_can_write() then raise insufficient_privilege; end if;

  -- Existing portal management takes a shared lock on the directory row.
  perform 1 from public.client_directory where id = p_client for update;
  if not found then
    -- A retry after a committed request can still drain its cleanup queue.
    return exists (select 1 from eba_private.client_deletion_audit where client_id = p_client);
  end if;

  insert into eba_private.client_deletion_audit (client_id, deleted_by) values (p_client, auth.uid());

  -- Only verified share records in this client's upload namespace qualify.
  insert into public.client_file_cleanup (object_path, client_id)
  select s.object_path, p_client
  from public.client_portal_shares s
  join storage.objects o on o.bucket_id = 'client-shared-files' and o.name = s.object_path
  where s.client_id = p_client and s.kind = 'file'
    and split_part(s.object_path, '/', 1) = p_client::text
    and not exists (
      select 1 from public.client_portal_shares other
      where other.object_path = s.object_path and other.client_id <> p_client
    );

  delete from public.client_portal_access where client_id = p_client;
  delete from public.client_portal_invites where client_id = p_client;
  delete from public.client_portal_shares where client_id = p_client;
  delete from public.client_portal_audit where client_id = p_client;
  delete from public.client_conversation_messages where client_id = p_client;
  delete from public.client_directory where id = p_client;
  return true;
end;
$$;

create function eba_private.finish_client_file_cleanup(p_paths text[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  removed integer;
begin
  if not eba_private.client_directory_can_write() then raise insufficient_privilege; end if;
  delete from public.client_file_cleanup q
  where q.object_path = any(p_paths) and not exists (
    select 1 from storage.objects o where o.bucket_id = 'client-shared-files' and o.name = q.object_path
  );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create function public.finish_client_file_cleanup(p_paths text[])
returns integer language sql security invoker set search_path = ''
as $$ select eba_private.finish_client_file_cleanup(p_paths); $$;

revoke all on function eba_private.finish_client_file_cleanup(text[]), public.finish_client_file_cleanup(text[]) from public, anon, authenticated;
grant execute on function eba_private.finish_client_file_cleanup(text[]), public.finish_client_file_cleanup(text[]) to authenticated;

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

  -- Lock the directory before taking locks on invitations or accounts.
  select * into invite from public.client_portal_invites
    where token_hash = p_hash and email = address;
  if not found then return 'invalid'; end if;
  perform 1 from public.client_directory where id = invite.client_id and deleted_at is null for share;
  if not found then return 'revoked'; end if;
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

commit;
