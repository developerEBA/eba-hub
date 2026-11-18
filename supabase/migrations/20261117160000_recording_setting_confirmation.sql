-- After company-visibility and import-preparation migrations. No Google calls.
begin;
create function public.calendar_confirm_recording(p_actor uuid,p_id uuid,p_version integer,p_url text,
 p_connection_version bigint,p_email text,p_enabled boolean) returns boolean
language plpgsql security invoker set search_path='' set lock_timeout='1s' as $$
declare o public.calendar_occurrences; previous_setting text:=coalesce(current_setting('eba.google_import',true),'');
begin
 if p_enabled is null or not public.calendar_reminder_account_active(p_actor) then return false; end if;
 -- Keep the checked authorization generation valid until local confirmation commits.
 perform singleton from public.google_organizer_connection where singleton=true and enabled and status='connected'
   and version=p_connection_version and email=p_email for share;
 if not found then return false; end if;
 select * into o from public.calendar_occurrences where id=p_id for update;
 if not found or o.status<>'scheduled' or o.version is distinct from p_version or o.join_url is distinct from p_url
   or o.provider_calendar_id is distinct from p_email then return false; end if;
 if not(o.organizer_id=p_actor or p_actor=any(o.attendee_ids) or (o.audience<>'private' and exists(
   select 1 from public.staff_memberships where user_id=p_actor and status='active' and role='ceo'))) then return false; end if;
 perform set_config('eba.google_import','on',true);
 update public.calendar_occurrences set recording_status=case when p_enabled then 'configured' else 'pending' end where id=o.id;
 perform set_config('eba.google_import',previous_setting,true);
 return true;
end $$;
revoke all on function public.calendar_confirm_recording(uuid,uuid,integer,text,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.calendar_confirm_recording(uuid,uuid,integer,text,bigint,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
