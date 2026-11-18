-- POST-MIGRATION integration checks. Staging recommended. Creates no Google
-- resources. All changes below ROLLBACK. Log in once as test Admin and CEO first.
begin;
do $$
declare admin_id uuid; admin_session uuid; ceo_id uuid; ceo_session uuid;
        result jsonb; start_version bigint;
begin
  select s.user_id,s.id into admin_id,admin_session from auth.sessions s
    join public.staff_memberships m on m.user_id=s.user_id
    join auth.users u on u.id=s.user_id
    where m.role='admin' and m.status='active' and u.email ~* '^[^@]+@enibrand\.com$'
      and (s.not_after is null or s.not_after>now()) order by s.created_at desc limit 1;
  select s.user_id,s.id into ceo_id,ceo_session from auth.sessions s
    join public.staff_memberships m on m.user_id=s.user_id
    where m.role='ceo' and m.status='active' and (s.not_after is null or s.not_after>now())
    order by s.created_at desc limit 1;
  if admin_id is null or ceo_id is null then raise exception 'Log in as an active test Admin and CEO first'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('google_organizer_connection','google_organizer_oauth_states'))
    then raise exception 'Unexpected token table RLS policy'; end if;
  if has_table_privilege('authenticated','public.google_organizer_connection','SELECT')
    or has_table_privilege('anon','public.google_organizer_oauth_states','SELECT')
    or has_function_privilege('authenticated','public.google_organizer_authorize(text,uuid,uuid,jsonb)','EXECUTE')
    then raise exception 'Browser credential privilege leak'; end if;
  -- Use the real service_role privileges, not postgres privileges, for RPCs.
  set local role service_role;
  begin
    perform public.google_organizer_authorize('disconnect',ceo_id,ceo_session,'{}');
    raise exception 'TEST FAILED: CEO authorized';
  exception when raise_exception then
    if sqlerrm<>'Google authorization denied' then raise; end if;
  end;
  perform public.google_organizer_authorize('start',admin_id,admin_session,
    jsonb_build_object('state_hash','fixture-state','browser_hash','fixture-browser','email','organizer@example.com','verifier','fixture-ciphertext','nonce','fixture-nonce'));
  select version into start_version from public.google_organizer_connection where singleton;
  begin
    perform public.google_organizer_authorize('consume',admin_id,admin_session,'{"state_hash":"fixture-state","browser_hash":"wrong"}');
    raise exception 'TEST FAILED: wrong browser accepted';
  exception when raise_exception then
    if sqlerrm<>'Invalid Google authorization state' then raise; end if;
  end;
  result:=public.google_organizer_authorize('consume',admin_id,admin_session,'{"state_hash":"fixture-state","browser_hash":"fixture-browser"}');
  if result->>'nonce'<>'fixture-nonce' then raise exception 'State not returned'; end if;
  begin
    perform public.google_organizer_authorize('consume',admin_id,admin_session,'{"state_hash":"fixture-state","browser_hash":"fixture-browser"}');
    raise exception 'TEST FAILED: replay accepted';
  exception when raise_exception then
    if sqlerrm<>'Invalid Google authorization state' then raise; end if;
  end;
  perform public.google_organizer_authorize('disconnect',admin_id,admin_session,'{}');
  if exists(select 1 from public.google_organizer_connection where enabled or refresh_ciphertext is not null or version<=start_version)
    then raise exception 'Local disconnect did not invalidate credential generation'; end if;
  begin
    perform public.google_organizer_authorize('save',admin_id,admin_session,'{"state_hash":"fixture-state","email":"organizer@example.com","subject":"fixture","ciphertext":"fixture","meet_supported":true}');
    raise exception 'TEST FAILED: disconnected flow saved';
  exception when raise_exception then
    if sqlerrm<>'Invalid Google authorization state' then raise; end if;
  end;
  reset role;
  raise notice 'Google organizer database authorization checks passed; all writes will roll back';
end $$;
rollback;
