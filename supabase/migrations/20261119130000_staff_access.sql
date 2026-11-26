-- Staff access. Apply manually; no Auth users, invitations or email are created here.
begin;
alter table public.staff_memberships drop constraint staff_memberships_role_check;
alter table public.staff_memberships add constraint staff_memberships_role_check check(role in('ceo','admin','staff','hod'));
alter table public.staff_memberships add column access_version integer not null default 1 check(access_version>0);
create table public.staff_access_profiles (
 user_id uuid primary key references public.staff_memberships(user_id),name text not null check(length(btrim(name)) between 1 and 120)
);
create table public.staff_access_invites (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,
 email text not null check(email=lower(btrim(email)) and email ~ '^[^@[:space:]]+@enibrand[.]com$'),
 name text not null check(length(btrim(name)) between 1 and 120),role text not null check(role in('staff','hod')),
 department text not null check(department in('graphics','development','communications','events','marketing')),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 invited_by uuid not null references auth.users(id),account_id uuid references auth.users(id),new_account boolean not null default false,
 status text not null default 'pending' check(status in('pending','accepted','revoked','expired','failed')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '48 hours'),accepted_at timestamptz,
 check(expires_at>created_at)
);
create unique index staff_access_one_pending_email on public.staff_access_invites(email) where status='pending';
create table public.staff_access_audit (
 id bigint generated always as identity primary key,actor uuid not null references auth.users(id),action text not null,
 target text not null,created_at timestamptz not null default now(),changes jsonb not null default '{}'
);
alter table public.staff_access_profiles enable row level security;
alter table public.staff_access_invites enable row level security;
alter table public.staff_access_audit enable row level security;
revoke all on public.staff_access_profiles,public.staff_access_invites,public.staff_access_audit from public,anon,authenticated;
grant select,insert,update on public.staff_access_profiles,public.staff_access_invites to service_role;
grant select,insert on public.staff_access_audit to service_role;
grant usage,select on sequence public.staff_access_audit_id_seq to service_role;
grant select(id,email,email_confirmed_at,deleted_at,banned_until) on auth.users to service_role;
grant select,insert,update on public.staff_memberships to service_role;
grant select,insert,delete on public.staff_department_assignments to service_role;
grant select on public.connect_profiles,public.client_portal_access to service_role;

create function public.staff_access_control(p_action text,p_actor uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare caller text;u record;member public.staff_memberships;invite public.staff_access_invites;
 address text;target uuid;v_id uuid;v_dept text;v_role text;v_name text;before_data jsonb;result jsonb;
begin
 -- Serialize membership/invite decisions, including acceptance and revocation.
 perform pg_advisory_xact_lock(1911191300);
 if p_action in('inspect','verify_identity','accept') then
  select * into invite from public.staff_access_invites where token_hash=p_data->>'token_hash' for update;
  if not found or invite.status<>'pending' or invite.expires_at<=clock_timestamp() or invite.account_id is null then raise exception 'Invitation unavailable'; end if;
  if not exists(select 1 from public.staff_memberships m join auth.users a on a.id=m.user_id
   where m.user_id=invite.invited_by and m.role='admin' and m.status='active' and a.email_confirmed_at is not null
   and a.deleted_at is null and (a.banned_until is null or a.banned_until<=clock_timestamp())) then raise exception 'Invitation authorizer inactive'; end if;
  if p_action='inspect' then return jsonb_build_object('new_account',invite.new_account); end if;
  select id,email,email_confirmed_at,deleted_at,banned_until into u from auth.users where id=p_actor;
  if u.id is null or u.id is distinct from invite.account_id or lower(u.email)<>invite.email or u.email_confirmed_at is null
   or u.deleted_at is not null or u.banned_until>clock_timestamp() then raise exception 'Invitation identity mismatch'; end if;
  if exists(select 1 from public.staff_memberships where user_id=u.id) or exists(select 1 from public.client_portal_access where user_id=u.id)
   then raise exception 'Account already assigned'; end if;
  if p_action='verify_identity' then return jsonb_build_object('ok',true); end if;
  insert into public.staff_memberships(user_id,role,status) values(u.id,invite.role,'active');
  insert into public.staff_access_profiles(user_id,name) values(u.id,invite.name);
  insert into public.staff_department_assignments(user_id,department) values(u.id,invite.department);
  update public.staff_access_invites set status='accepted',accepted_at=clock_timestamp() where id=invite.id;
  insert into public.staff_access_audit(actor,action,target,changes) values(u.id,'invite_accepted',invite.email,jsonb_build_object('role',invite.role,'department',invite.department,'status','active'));
  return jsonb_build_object('ok',true,'dashboard_available',false);
 end if;
 select m.role into caller from public.staff_memberships m join auth.users a on a.id=m.user_id
  where m.user_id=p_actor and m.status='active' and m.role in('ceo','admin') and lower(a.email) ~ '^[^@]+@enibrand[.]com$'
  and a.email_confirmed_at is not null and a.deleted_at is null and (a.banned_until is null or a.banned_until<=clock_timestamp());
 if caller is null then raise exception 'Active management account required'; end if;
 if p_action='directory' then
  return jsonb_build_object('members',coalesce((select jsonb_agg(t) from (
   select m.user_id as id,coalesce(p.name,c.display_name,a.email) as name,a.email,m.role,m.status,m.access_version as version,
    coalesce((select jsonb_agg(d.department order by d.department) from public.staff_department_assignments d where d.user_id=m.user_id),'[]') as departments,
    case when a.deleted_at is not null then 'Deleted' when a.banned_until>clock_timestamp() then 'Banned' when a.email_confirmed_at is null then 'Email unverified' else 'Verified' end as account_status,
    m.status='active' and m.role in('ceo','admin') and lower(a.email) ~ '^[^@]+@enibrand[.]com$' and a.email_confirmed_at is not null and a.deleted_at is null and (a.banned_until is null or a.banned_until<=clock_timestamp()) as hub_access
   from public.staff_memberships m join auth.users a on a.id=m.user_id left join public.staff_access_profiles p on p.user_id=m.user_id
    left join public.connect_profiles c on c.user_id=m.user_id order by a.email limit 500)t),'[]'),
   'invitations',coalesce((select jsonb_agg(t) from(select i.id,i.name,i.email,i.role,i.department,
    case when i.status='pending' and i.expires_at<=clock_timestamp() then 'expired' else i.status end as status,i.expires_at,
    case when a.id is null then 'Not bound' when a.email_confirmed_at is null then 'Email verification pending' else 'Verified' end as account_status
    from public.staff_access_invites i left join auth.users a on a.id=i.account_id order by i.created_at desc limit 500)t),'[]'),
   'audit',coalesce((select jsonb_agg(t) from(select id,actor,action,target,created_at from public.staff_access_audit order by id desc limit 50)t),'[]'),
   'truncated',(select count(*)>500 from public.staff_memberships) or (select count(*)>500 from public.staff_access_invites));
 end if;
 if caller<>'admin' then raise exception 'Active Admin required'; end if;
 if p_action='invite' then
  address:=lower(btrim(p_data->>'email'));v_name:=btrim(p_data->>'name');v_role:=p_data->>'role';v_dept:=p_data->>'department';
  if address is null or length(address)>254 or address !~ '^[^@[:space:]]+@enibrand[.]com$' or v_role not in('staff','hod')
   or v_role is null or v_dept is null or v_dept not in('graphics','development','communications','events','marketing') or v_name is null or length(v_name) not between 1 and 120 then raise exception 'Invalid staff assignment'; end if;
  select id,email,email_confirmed_at,deleted_at,banned_until into u from auth.users where lower(email)=address;
  if u.id is not null and (exists(select 1 from public.staff_memberships where user_id=u.id) or exists(select 1 from public.client_portal_access where user_id=u.id)
   or u.deleted_at is not null or u.banned_until>clock_timestamp()) then raise exception 'Account already assigned or unavailable'; end if;
  update public.staff_access_invites set status='expired' where email=address and status='pending' and expires_at<=clock_timestamp();
  insert into public.staff_access_invites(email,name,role,department,token_hash,invited_by,request_id)
   values(address,v_name,v_role,v_dept,p_data->>'token_hash',p_actor,(p_data->>'request_id')::uuid) returning id into v_id;
  insert into public.staff_access_audit(actor,action,target,changes) values(p_actor,'invite_created',address,jsonb_build_object('role',v_role,'department',v_dept));
  return jsonb_build_object('id',v_id,'existing_account',u.id is not null);
 end if;
 if p_action in('bind','fail','revoke') then
  select * into invite from public.staff_access_invites where id=(p_data->>'id')::uuid for update;
  if not found or invite.status<>'pending' then raise exception 'Invitation changed'; end if;
  if p_action='bind' then
   if invite.invited_by<>p_actor or invite.expires_at<=clock_timestamp() then raise exception 'Invitation changed'; end if;
   select id,email,email_confirmed_at,deleted_at,banned_until into u from auth.users where id=(p_data->>'account_id')::uuid and lower(email)=invite.email;
   if u.id is null or exists(select 1 from public.staff_memberships where user_id=u.id) or exists(select 1 from public.client_portal_access where user_id=u.id) then raise exception 'Account unavailable'; end if;
   update public.staff_access_invites set account_id=u.id,new_account=coalesce((p_data->>'new_account')::boolean,false) where id=invite.id;
  else
   update public.staff_access_invites set status=case when p_action='fail' then 'failed' else 'revoked' end where id=invite.id;
   insert into public.staff_access_audit(actor,action,target) values(p_actor,case when p_action='fail' then 'invite_failed' else 'invite_revoked' end,invite.email);
  end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action not in('update','deactivate','reactivate') then raise exception 'Invalid management action'; end if;
 target:=(p_data->>'id')::uuid;
 select * into member from public.staff_memberships where user_id=target for update;
 if not found then raise exception 'Staff record unavailable'; end if;
 if target=p_actor then raise exception 'Cannot change your own access'; end if;
 if member.role='admin' and member.status='active' and (select count(*) from public.staff_memberships where role='admin' and status='active')<=1 then raise exception 'Cannot remove last active Admin'; end if;
 if member.role in('ceo','admin') then raise exception 'Privileged accounts require controlled provisioning'; end if;
 if member.access_version is distinct from (p_data->>'version')::integer then raise exception 'Staff record changed'; end if;
 select id,email,email_confirmed_at,deleted_at,banned_until into u from auth.users where id=target;
 if p_action<>'deactivate' and (u.email_confirmed_at is null or u.deleted_at is not null or u.banned_until>clock_timestamp()
  or lower(u.email) !~ '^[^@]+@enibrand[.]com$') then raise exception 'Verified company account required'; end if;
 before_data:=jsonb_build_object('role',member.role,'status',member.status,'departments',(select jsonb_agg(department) from public.staff_department_assignments where user_id=target));
 if p_action='update' then
  v_role:=p_data->>'role';v_dept:=p_data->>'department';v_name:=btrim(p_data->>'name');
  if v_role is null or v_role not in('staff','hod') or v_dept is null or v_dept not in('graphics','development','communications','events','marketing') or v_name is null or length(v_name) not between 1 and 120 then raise exception 'Invalid staff assignment'; end if;
  update public.staff_memberships set role=v_role,access_version=access_version+1 where user_id=target;
  insert into public.staff_access_profiles values(target,v_name) on conflict(user_id) do update set name=excluded.name;
  delete from public.staff_department_assignments where user_id=target;
  insert into public.staff_department_assignments values(target,v_dept);
 else
  update public.staff_memberships set status=case when p_action='deactivate' then 'inactive' else 'active' end,access_version=access_version+1 where user_id=target;
 end if;
 insert into public.staff_access_audit(actor,action,target,changes) values(p_actor,p_action,u.email,jsonb_build_object('before',before_data,'after',
  jsonb_build_object('role',coalesce(v_role,member.role),'status',case when p_action='deactivate' then 'inactive' when p_action='reactivate' then 'active' else member.status end,'department',v_dept)));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_access_control(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.staff_access_control(text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
