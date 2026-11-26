begin;

-- Directory deletion removes only the staff membership and assignments.
-- Auth identity, profile, client access, and all activity/history are retained.
grant delete on public.staff_memberships, public.staff_access_profiles to service_role;

create or replace function public.staff_access_delete_member(p_actor uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare caller text;member public.staff_memberships;target uuid;u record;before_data jsonb;
begin
 perform pg_advisory_xact_lock(1911191300);

 select m.role into caller
 from public.staff_memberships m join auth.users a on a.id=m.user_id
 where m.user_id=p_actor and m.status='active' and m.role='admin'
   and lower(a.email) ~ '^[^@]+@enibrand[.]com$' and a.email_confirmed_at is not null
   and a.deleted_at is null and (a.banned_until is null or a.banned_until<=clock_timestamp());
 if caller is distinct from 'admin' then raise exception 'Active Admin required'; end if;
 if p_data->>'confirm' is distinct from 'true' then raise exception 'Confirm staff removal first'; end if;
 if coalesce(p_data->>'id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Invalid staff record'; end if;
 target:=(p_data->>'id')::uuid;

 select * into member from public.staff_memberships where user_id=target for update;
 if not found or member.role not in('staff','hod') then raise exception 'Staff record unavailable'; end if;
 if target=p_actor then raise exception 'Cannot remove your own access'; end if;
 if member.access_version is distinct from (p_data->>'version')::integer then raise exception 'Staff record changed'; end if;
 select id,email,email_confirmed_at,deleted_at,banned_until into u from auth.users where id=target;
 if u.id is null then raise exception 'Staff account unavailable'; end if;

 select jsonb_build_object(
   'role',member.role,
   'status',member.status,
   'departments',coalesce((select jsonb_agg(d.department order by d.department) from public.staff_department_assignments d where d.user_id=target),'[]'::jsonb),
   'profile_name',(select p.name from public.staff_access_profiles p where p.user_id=target)
 ) into before_data;

 delete from public.staff_department_assignments where user_id=target;
 delete from public.staff_access_profiles where user_id=target;
 delete from public.staff_memberships where user_id=target;
 insert into public.staff_access_audit(actor,action,target,changes)
 values(p_actor,'member_deleted',coalesce(u.email,target::text),jsonb_build_object(
   'before',before_data,
   'after',jsonb_build_object('staff_membership','removed','auth_identity','preserved','existing_records','preserved')
 ));
 return jsonb_build_object('ok',true,'membership_removed',true,'auth_identity_preserved',true);
end $$;

revoke all on function public.staff_access_delete_member(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.staff_access_delete_member(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
