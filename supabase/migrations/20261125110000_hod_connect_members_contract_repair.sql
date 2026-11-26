-- Compatibility repair for environments where the HOD migration completed
-- while connect_department_members(uuid) had no prior definition and therefore
-- was created with the temporary five-column result shape.
--
-- This is a forward migration. It deliberately refuses to drop a function with
-- catalog dependents and never uses CASCADE. App callers use the established
-- three-column result (src/app/dashboard/connect/page.tsx).
begin;

do $$
declare
  function_oid oid := to_regprocedure('public.connect_department_members(uuid)');
  result_shape text;
  dependent_objects text;
begin
  if to_regprocedure('eba_private.connect_can_read(uuid)') is null
    or to_regprocedure('eba_private.connect_is_active(uuid)') is null then
    raise exception 'HOD Connect authorization helpers are missing; do not run the compatibility repair';
  end if;

  if function_oid is not null then
    select lower(regexp_replace(pg_get_function_result(function_oid), '\s+', '', 'g'))
      into result_shape;

    if result_shape not in (
      'table(user_iduuid,display_nametext,avatar_urltext)',
      'table(user_iduuid,display_nametext,avatar_urltext,roletext,departmenttext)'
    ) then
      raise exception 'Unexpected connect_department_members return shape: %', result_shape;
    end if;

    if result_shape = 'table(user_iduuid,display_nametext,avatar_urltext,roletext,departmenttext)' then
      select string_agg(pg_describe_object(d.classid,d.objid,d.objsubid), '; ' order by d.classid,d.objid,d.objsubid)
        into dependent_objects
      from pg_depend d
      where d.refclassid='pg_proc'::regclass and d.refobjid=function_oid;

      if dependent_objects is not null then
        raise exception 'connect_department_members has catalog dependents; inspect before recreating: %', dependent_objects;
      end if;

      execute 'drop function public.connect_department_members(uuid)';
    end if;
  end if;
end $$;

create or replace function public.connect_department_members(room uuid)
returns table(user_id uuid,display_name text,avatar_url text)
language sql stable security definer set search_path='' as $$
 select p.user_id,p.display_name,p.avatar_url
 from public.connect_conversations c join public.connect_profiles p on true join public.staff_memberships m on m.user_id=p.user_id
 join public.staff_department_assignments a on a.user_id=p.user_id
 join auth.users u on u.id=p.user_id
 where c.id=room and c.room_type='department' and eba_private.connect_can_read(room)
   and a.department=c.department and m.status='active' and m.role in('staff','hod','ceo','admin')
   and lower(u.email) ~ '^[^@]+@enibrand[.]com$' and u.email_confirmed_at is not null
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
   and (m.role not in('staff','hod') or eba_private.connect_is_active(m.user_id))
 union
 select p.user_id,p.display_name,p.avatar_url
 from public.connect_conversations c join public.connect_profiles p on true join public.staff_memberships m on m.user_id=p.user_id
 join auth.users u on u.id=p.user_id
 where c.id=room and c.room_type='department' and eba_private.connect_can_read(room)
   and m.role in('ceo','admin') and m.status='active'
   and lower(u.email) ~ '^[^@]+@enibrand[.]com$' and u.email_confirmed_at is not null
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 order by 2,1;
$$;

-- Restore the intended API grant set from the base private-room migration.
revoke all on function public.connect_department_members(uuid) from public,anon,authenticated;
grant execute on function public.connect_department_members(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
