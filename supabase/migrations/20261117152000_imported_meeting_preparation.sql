-- After verified import-owner migration. No live Google calls during migration.
begin;
alter table public.calendar_occurrences add column preparation_attempted_at timestamptz;
create or replace function public.calendar_google_import(p_action text,p_email text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='1s' as $$
declare st public.calendar_google_import_state; conn public.google_organizer_connection;
 o public.calendar_occurrences; e jsonb; resolved_owner uuid; people uuid[]; series uuid;
 v_lease uuid; v_checked text; count_imported integer:=0; prior_setting text:=coalesce(current_setting('eba.google_import',true),'');
 v_start timestamptz; v_end timestamptz; v_url text;
begin
 select * into conn from public.google_organizer_connection where singleton=true for share;
 if not found or not conn.enabled or conn.email is distinct from p_email then return null; end if;
 if p_action<>'reset' then resolved_owner:=public.calendar_google_import_owner(p_email,p_data->>'owner_email'); end if;
 insert into public.calendar_google_import_state(singleton,email,window_from,window_to)
 values(true,p_email,statement_timestamp()-interval '1 day',statement_timestamp()+interval '90 days') on conflict do nothing;
 select * into st from public.calendar_google_import_state where singleton=true for update;
 if p_action='claim' then
   if st.lease_until>clock_timestamp() then return null; end if;
   if st.email<>p_email or st.connection_version is distinct from conn.version or st.page_token is null or st.owner_id is distinct from resolved_owner then
     st.window_from:=statement_timestamp()-interval '1 day';st.window_to:=statement_timestamp()+interval '90 days';st.page_token:=null;
   end if;
   v_lease:=gen_random_uuid();
   update public.calendar_google_import_state set email=p_email,window_from=st.window_from,window_to=st.window_to,
     page_token=st.page_token,lease=v_lease,lease_until=clock_timestamp()+interval '30 seconds',connection_version=conn.version,owner_id=resolved_owner where singleton=true;
   select provider_event_id into v_checked from public.calendar_occurrences where source='google'
     and provider_calendar_id=p_email and status='scheduled' and ends_at>statement_timestamp()
     order by case when join_url is null and preparation_attempted_at is null then 0 else 1 end,import_checked_at nulls first,id limit 1;
   return jsonb_build_object('lease',v_lease,'from',st.window_from,'to',st.window_to,'page',st.page_token,'check',v_checked);
 end if;
 if st.lease is distinct from (p_data->>'lease')::uuid or st.lease_until<=clock_timestamp()
   or st.email<>p_email or st.connection_version is distinct from conn.version then raise exception 'Import lease expired'; end if;
 if p_action='reset' then
   update public.calendar_google_import_state set page_token=null,lease=null,lease_until=null where singleton=true;return '{}'::jsonb;
 end if;
 if st.owner_id is distinct from resolved_owner then raise exception 'Import owner changed during processing'; end if;
 if p_action<>'finish' or jsonb_typeof(p_data->'events')<>'array' or jsonb_array_length(p_data->'events')>101 then raise exception 'Invalid import batch'; end if;
 perform set_config('eba.google_import','on',true);
 for e in select value from jsonb_array_elements(p_data->'events') loop
   if length(e->>'id') not between 1 and 1024 then continue; end if;
   select * into o from public.calendar_occurrences where provider='google' and provider_calendar_id=p_email and provider_event_id=e->>'id' for update;
   if found and o.source<>'google' then continue; end if;
   if o.id is not null and o.organizer_id<>resolved_owner then raise exception 'Existing imported owner differs; review required'; end if;
   if coalesce((e->>'cancelled')::boolean,false) then
     if o.id is not null and o.status<>'cancelled' then
       update public.calendar_occurrences set status='cancelled',cancellation_reason='organizer',join_url=null,
         version=version+1,import_checked_at=case when e ? 'recording_status' then clock_timestamp() else import_checked_at end where id=o.id;
     end if;
     continue;
   end if;
   v_start:=(e->>'start')::timestamptz;v_end:=(e->>'end')::timestamptz;
   if v_start is null or v_end is null or v_end<=v_start or v_end>v_start+interval '24 hours' then continue; end if;
   select coalesce(array_agg(u.id order by u.id),'{}'::uuid[]) into people from auth.users u
     where u.id<>resolved_owner and lower(u.email) in(select lower(value) from jsonb_array_elements_text(e->'attendees'))
       and public.calendar_reminder_account_active(u.id);
   if cardinality(people)>100 then continue; end if;
   v_url:=case when e->>'url' ~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$' then e->>'url' else null end;
   if o.id is null then
     insert into public.calendar_series(organizer_id,frequency,provider,provider_calendar_id) values(resolved_owner,'once','google',p_email) returning id into series;
     insert into public.calendar_occurrences(series_id,organizer_id,ordinal,original_starts_at,title,agenda,starts_at,ends_at,
       frequency,attendee_ids,source,provider,provider_calendar_id,provider_event_id,join_url,sync_status,import_checked_at)
     values(series,resolved_owner,0,v_start,left(e->>'title',160),left(e->>'agenda',4000),v_start,v_end,'once',people,'google','google',p_email,e->>'id',v_url,'synced',clock_timestamp());
     count_imported:=count_imported+1;
   else
     if row(o.title,o.agenda,o.starts_at,o.ends_at,o.attendee_ids,o.join_url,o.status)
       is distinct from row(left(e->>'title',160),left(e->>'agenda',4000),v_start,v_end,people,v_url,'scheduled'::text) then
       update public.calendar_occurrences set title=left(e->>'title',160),agenda=left(e->>'agenda',4000),starts_at=v_start,ends_at=v_end,
         attendee_ids=people,join_url=v_url,status='scheduled',cancellation_reason=null,version=version+1,import_checked_at=case when e ? 'recording_status' then clock_timestamp() else import_checked_at end where id=o.id;
       count_imported:=count_imported+1;
     elsif e ? 'recording_status' then update public.calendar_occurrences set import_checked_at=clock_timestamp() where id=o.id;end if;
   end if;
   -- Only the individually rechecked event carries a confirmed preparation result.
   if e->>'recording_status' in ('pending','configured','warning') then
     update public.calendar_occurrences set recording_status=e->>'recording_status',import_checked_at=clock_timestamp(),preparation_attempted_at=clock_timestamp()
      where source='google' and provider_calendar_id=p_email and provider_event_id=e->>'id';
   end if;
 end loop;
 perform set_config('eba.google_import',prior_setting,true);
 update public.calendar_google_import_state set page_token=nullif(p_data->>'page',''),lease=null,lease_until=null where singleton=true;
 return jsonb_build_object('imported',count_imported);
end $$;

notify pgrst,'reload schema';
commit;
