begin;
do $$
declare admin_id uuid; ceo_id uuid; req uuid:=gen_random_uuid(); first_id uuid; second_id uuid;
  v_start timestamptz:=date_trunc('hour',now())+interval '3 days'; claim jsonb; next_claim jsonb; res jsonb; lease uuid;
begin
  select u.id into admin_id from auth.users u join public.staff_memberships m on m.user_id=u.id
    where u.email='eba-admin-test@enibrand.com' and m.role='admin' and m.status='active';
  select u.id into ceo_id from auth.users u join public.staff_memberships m on m.user_id=u.id
    where u.email='eba-ceo-test@enibrand.com' and m.role='ceo' and m.status='active';
  if admin_id is null or ceo_id is null then raise exception 'Existing active test Admin and CEO required'; end if;
  if has_table_privilege('authenticated','public.calendar_sync_jobs','SELECT')
    or has_column_privilege('authenticated','public.calendar_occurrences','provider_event_id','SELECT')
    or has_column_privilege('authenticated','public.calendar_occurrences','sync_error','SELECT')
    or has_function_privilege('authenticated','public.calendar_sync_control(text,uuid,uuid,integer,jsonb)','EXECUTE')
    then raise exception 'Browser synchronization privilege leak'; end if;
  set local role service_role;
  first_id:=public.calendar_mutate(admin_id,req,'create',null,'one',null,jsonb_build_object(
    'title','DEV Calendar Part 2 SQL','agenda','Fixture','startsAt',v_start,'endsAt',v_start+interval '1 hour',
    'frequency','weekly','until',(v_start at time zone 'Africa/Lagos')::date+14,'attendees',jsonb_build_array(ceo_id),'departments','[]'::jsonb));
  if (select count(*) from public.calendar_sync_jobs j join public.calendar_occurrences o on o.id=j.occurrence_id where o.series_id=req)<>3 then raise exception 'Recurrence enqueue failed'; end if;
  claim:=public.calendar_sync_control('claim',first_id);
  lease:=(claim->'job'->>'lease_token')::uuid;
  if lease is null or public.calendar_sync_control('claim',first_id) is not null then raise exception 'Concurrent claim accepted'; end if;
  perform public.calendar_sync_control('bind',first_id,lease,1,'{"email":"fixture@example.com","event_id":"ebafixture","create_attempt":true}');
  perform public.calendar_mutate(admin_id,gen_random_uuid(),'update',first_id,'one',1,jsonb_build_object(
    'title','DEV Calendar Part 2 edited','agenda','Updated','startsAt',v_start+interval '2 hours','endsAt',v_start+interval '3 hours',
    'frequency','once','until',null,'attendees',jsonb_build_array(ceo_id),'departments','[]'::jsonb));
  res:=public.calendar_sync_control('finish',first_id,lease,1,'{"state":"done","sync_status":"synced","join_url":"https://meet.google.com/abc-defg-hij","recording_status":"configured"}');
  if res is not null or exists(select 1 from public.calendar_occurrences where id=first_id and (sync_status='synced' or join_url is not null)) then raise exception 'Stale completion overwrote edited meeting'; end if;
  next_claim:=public.calendar_sync_control('claim',first_id);
  if (next_claim->'meeting'->>'version')::integer<>2 then raise exception 'Latest version not claimed'; end if;
  lease:=(next_claim->'job'->>'lease_token')::uuid;
  perform public.calendar_sync_control('finish',first_id,lease,2,'{"state":"done","sync_status":"synced","join_url":"https://meet.google.com/abc-defg-hij","recording_status":"warning"}');
  if not exists(select 1 from public.calendar_occurrences where id=first_id and join_url is not null and recording_status='warning') then raise exception 'Partial recording failure lost usable link'; end if;
  begin
    perform public.calendar_sync_control('retry',first_id,null,null,jsonb_build_object('actor',ceo_id));
    raise exception 'TEST FAILED: attendee retry accepted';
  exception when raise_exception then if sqlerrm<>'Only the organizer can retry' then raise; end if; end;
  select id into second_id from public.calendar_occurrences where series_id=req and ordinal=1;
  perform public.calendar_mutate(admin_id,gen_random_uuid(),'cancel',second_id,'remaining',1,'{}');
  if exists(select 1 from public.calendar_occurrences where series_id=req and ordinal>=1 and status<>'cancelled') then raise exception 'Remaining cancellation failed'; end if;
  if (select version from public.calendar_occurrences where id=first_id)<>2 then raise exception 'Earlier exception changed'; end if;
  claim:=public.calendar_sync_control('claim',second_id);
  if claim->'meeting'->>'status'<>'cancelled' then raise exception 'Cancellation job lost tombstone'; end if;
  reset role;
  raise notice 'Part 2 transactional authorization/version/queue checks passed. Rolling back all fixture writes.';
end $$;
rollback;
