-- Explicit classification only: no existing meeting is made public/company-wide.
begin;
alter table public.calendar_occurrences add column audience text not null default 'private'
 check(audience in('private','company','general','leadership','department')),
 add column audience_version integer not null default 1 check(audience_version>0);
grant select(audience,audience_version) on public.calendar_occurrences to authenticated;
drop policy "Only organizer and invited people read occurrences" on public.calendar_occurrences;
create policy "Participant or CEO company meeting visibility" on public.calendar_occurrences for select to authenticated
 using((select public.calendar_access()) and (organizer_id=(select auth.uid()) or (select auth.uid())=any(attendee_ids)
   or (audience<>'private' and exists(select 1 from public.staff_memberships m where m.user_id=(select auth.uid()) and m.role='ceo' and m.status='active'))));
create function public.calendar_set_audience(p_actor uuid,p_id uuid,p_version integer,p_audience text) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.calendar_occurrences; previous_setting text:=coalesce(current_setting('eba.google_import',true),'');
begin
 if not public.calendar_reminder_account_active(p_actor) then raise exception 'Active account required'; end if;
 if p_audience is null or p_audience not in('private','company','general','leadership') then raise exception 'Choose a supported audience'; end if;
 select * into o from public.calendar_occurrences where id=p_id for update;
 if not found or o.organizer_id<>p_actor then raise exception 'Only the meeting organizer can change its audience'; end if;
 if p_version is null or o.audience_version<>p_version then raise exception 'Meeting visibility changed; refresh first'; end if;
 -- Local classification of imported records does not edit Google event fields.
 perform set_config('eba.google_import','on',true);
 update public.calendar_occurrences set audience=p_audience,audience_version=audience_version+1 where id=o.id;
 perform set_config('eba.google_import',previous_setting,true);
end $$;
revoke all on function public.calendar_set_audience(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.calendar_set_audience(uuid,uuid,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
