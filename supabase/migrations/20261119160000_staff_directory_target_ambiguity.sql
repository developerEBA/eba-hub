-- Fix only the ambiguous directory audit projection in the installed RPC.
-- Preserve the installed management logic, grants, invoker security and rollout gates.
begin;
do $$
declare definition text;old_projection text:='select id,actor,action,target,created_at from public.staff_access_audit order by id desc limit 50';
 new_projection text:='select audit.id,audit.actor,audit.action,audit.target,audit.created_at from public.staff_access_audit as audit order by audit.id desc limit 50';
begin
 definition:=pg_get_functiondef('public.staff_access_control(text,uuid,jsonb)'::regprocedure);
 if strpos(definition,old_projection)=0 then
  raise exception 'Expected audit projection not found; inspect the installed RPC before applying this forward repair';
 end if;
 execute replace(definition,old_projection,new_projection);
end $$;
notify pgrst,'reload schema';
commit;
