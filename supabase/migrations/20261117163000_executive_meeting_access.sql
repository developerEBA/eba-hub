-- Explicit user authorization: every EBA meeting is visible to active CEO/Admin.
-- No audience backfill, account changes, invitations or Google calls.
begin;
drop policy if exists "Only organizer and invited people read occurrences" on public.calendar_occurrences;
drop policy if exists "Participant or CEO company meeting visibility" on public.calendar_occurrences;
drop policy if exists "Active executives read all meetings" on public.calendar_occurrences;
create policy "Active executives read all meetings" on public.calendar_occurrences for select to authenticated
 using((select public.calendar_access()));

-- Same confirmation safeguards, now available to every eligible executive viewer.
create or replace function public.calendar_confirm_recording(p_actor uuid,p_id uuid,p_version integer,p_url text,
 p_connection_version bigint,p_email text,p_enabled boolean) returns boolean
language plpgsql security invoker set search_path='' set lock_timeout='1s' as $$
declare o public.calendar_occurrences; previous_setting text:=coalesce(current_setting('eba.google_import',true),'');
begin
 if p_enabled is null or not public.calendar_reminder_account_active(p_actor) then return false; end if;
 perform singleton from public.google_organizer_connection where singleton=true and enabled and status='connected'
   and version=p_connection_version and email=p_email for share;
 if not found then return false; end if;
 select * into o from public.calendar_occurrences where id=p_id for update;
 if not found or o.status<>'scheduled' or o.version is distinct from p_version or o.join_url is distinct from p_url
   or o.provider_calendar_id is distinct from p_email then return false; end if;
 perform set_config('eba.google_import','on',true);
 update public.calendar_occurrences set recording_status=case when p_enabled then 'configured' else 'pending' end where id=o.id;
 perform set_config('eba.google_import',previous_setting,true);
 return true;
end $$;
revoke all on function public.calendar_confirm_recording(uuid,uuid,integer,text,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.calendar_confirm_recording(uuid,uuid,integer,text,bigint,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
