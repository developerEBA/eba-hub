-- Forward-only after Google import. Does not alter accounts or OAuth credentials.
begin;
create table public.calendar_google_import_owners (
 singleton boolean primary key default true check(singleton),
 google_email text not null,google_subject text not null,connected_at timestamptz not null,
 owner_id uuid not null references public.staff_memberships(user_id),verified_at timestamptz not null default now()
);
alter table public.calendar_google_import_owners enable row level security;
revoke all on public.calendar_google_import_owners from public,anon,authenticated;
grant select,insert,update on public.calendar_google_import_owners to service_role;
alter table public.calendar_google_import_state add column owner_id uuid references public.staff_memberships(user_id);

-- Explicit configuration AND saved OAuth proof, never a domain/role-based guess.
-- No session/token/verifier values are copied into this durable mapping.
create function public.calendar_google_import_owner(p_email text,p_owner_email text default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare c public.google_organizer_connection; person uuid;
begin
 select * into c from public.google_organizer_connection where singleton=true for share;
 if not found or not c.enabled or c.status<>'connected' or c.email is distinct from p_email
   or c.subject is null or c.connected_at is null or c.verified_at is null then
   raise exception 'Import connection unavailable';
 end if;
 if nullif(p_owner_email,'') is null then
   select u.id into person from auth.users u where u.email=p_email and public.calendar_reminder_account_active(u.id);
   if person is null then raise exception 'Import organizer account is not eligible; explicit verified owner mapping required'; end if;
   return person;
 end if;
 select u.id into person from auth.users u join public.staff_memberships m on m.user_id=u.id
 where u.email=p_owner_email and m.role='admin' and public.calendar_reminder_account_active(u.id);
 if person is null then raise exception 'Configured import owner must be an existing verified active Admin'; end if;
 if exists(select 1 from public.calendar_google_import_owners v where v.singleton=true
   and v.owner_id=person and v.google_email=c.email and v.google_subject=c.subject and v.connected_at=c.connected_at) then
   return person;
 end if;
 -- saved_at and connected_at are stamped in the SAME successful OAuth-save
 -- transaction. Unconsumed, denied, failed and different Admin flows do not count.
 if not exists(select 1 from public.google_organizer_oauth_states s where s.admin_id=person
   and s.organizer_email=c.email and s.consumed_at is not null and s.saved_at=c.connected_at
   and s.version<c.version) then
   raise exception 'Successful authorization proof for configured import owner is unavailable';
 end if;
 insert into public.calendar_google_import_owners(singleton,google_email,google_subject,connected_at,owner_id)
 values(true,c.email,c.subject,c.connected_at,person)
 on conflict(singleton) do update set google_email=excluded.google_email,google_subject=excluded.google_subject,
   connected_at=excluded.connected_at,owner_id=excluded.owner_id,verified_at=now();
 return person;
end $$;
revoke all on function public.calendar_google_import_owner(text,text) from public,anon,authenticated;
grant execute on function public.calendar_google_import_owner(text,text) to service_role;

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
     and provider_calendar_id=p_email and status='scheduled' and ends_at>statement_timestamp()-interval '1 day'
     order by import_checked_at nulls first,id limit 1;
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
         version=version+1,import_checked_at=clock_timestamp() where id=o.id;
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
         attendee_ids=people,join_url=v_url,status='scheduled',cancellation_reason=null,version=version+1,import_checked_at=clock_timestamp() where id=o.id;
       count_imported:=count_imported+1;
     else update public.calendar_occurrences set import_checked_at=clock_timestamp() where id=o.id;end if;
   end if;
 end loop;
 perform set_config('eba.google_import',prior_setting,true);
 update public.calendar_google_import_state set page_token=nullif(p_data->>'page',''),lease=null,lease_until=null where singleton=true;
 return jsonb_build_object('imported',count_imported);
end $$;

notify pgrst,'reload schema';
commit;
