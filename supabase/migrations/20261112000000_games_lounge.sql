begin;

-- Social games only. No foreign keys, triggers or writes to recognition/performance tables.
create table public.game_nights (
  id uuid primary key default gen_random_uuid(), title text not null check (length(title) between 1 and 100),
  starts_at timestamptz not null, games text[] not null,
  created_by uuid not null references auth.users(id),
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  created_at timestamptz not null default now(),
  check (cardinality(games) between 1 and 6 and games <@ array['sudoku','ludo','chess','checkers','tic-tac-toe','trivia']::text[])
);
create table public.game_rooms (
  id uuid primary key default gen_random_uuid(), game text not null check (game in ('ludo','chess','checkers','tic-tac-toe','trivia')),
  host_id uuid not null references auth.users(id), capacity integer not null check (capacity between 2 and 4),
  status text not null default 'waiting' check (status in ('waiting','active','finished')),
  version integer not null default 0 check (version >= 0), round integer not null default 1 check (round > 0),
  visibility text not null default 'open' check (visibility in ('open','invite')),
  session_id uuid references public.game_nights(id), result jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (game in ('ludo','trivia') or capacity = 2)
);
create index game_rooms_lobby on public.game_rooms(created_at desc);
create index game_rooms_night on public.game_rooms(session_id);
create table public.game_players (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id), seat integer not null check (seat between 0 and 3),
  display_name text not null check (length(display_name) between 1 and 100),
  last_seen timestamptz not null default now(), left_at timestamptz,
  primary key (room_id,user_id)
);
create unique index game_players_seat on public.game_players(room_id,seat) where left_at is null;
create index game_players_user on public.game_players(user_id);
create table public.game_invites (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id), primary key(room_id,user_id)
);
-- No browser grants or realtime publication on private state or request records.
create table public.game_states (room_id uuid primary key references public.game_rooms(id) on delete cascade, state jsonb not null);
create table public.game_requests (
  actor_id uuid not null references auth.users(id), request_id uuid not null,
  room_id uuid references public.game_rooms(id) on delete cascade, primary key(actor_id,request_id), created_at timestamptz not null default now()
);
create table public.game_results (
  room_id uuid not null references public.game_rooms(id) on delete cascade, round integer not null,
  result jsonb not null, completed_at timestamptz not null default now(), primary key(room_id,round)
);

create function public.games_access() returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.staff_memberships where user_id = (select auth.uid()) and status = 'active' and role in ('ceo','admin'))
    and coalesce((select auth.jwt())->>'email','') ~* '^[^@]+@enibrand[.]com$';
$$;
revoke all on function public.games_access() from public,anon;
grant execute on function public.games_access() to authenticated;

alter table public.game_nights enable row level security;
alter table public.game_rooms enable row level security;
alter table public.game_players enable row level security;
alter table public.game_invites enable row level security;
alter table public.game_states enable row level security;
alter table public.game_requests enable row level security;
alter table public.game_results enable row level security;
revoke all on public.game_nights,public.game_rooms,public.game_players,public.game_invites,public.game_states,public.game_requests,public.game_results from public,anon,authenticated;
grant select on public.game_nights,public.game_rooms,public.game_players,public.game_invites,public.game_results to authenticated;
grant all on public.game_nights,public.game_rooms,public.game_players,public.game_invites,public.game_states,public.game_requests,public.game_results to service_role;
-- Explicit prerequisite reads rather than depending on project-specific default grants.
grant select on public.staff_memberships, public.connect_profiles to service_role;
create policy "Hub can read sessions" on public.game_nights for select to authenticated using ((select public.games_access()));
create policy "Hub can discover open or invited rooms" on public.game_rooms for select to authenticated using (
  (select public.games_access()) and (visibility = 'open' or host_id = (select auth.uid()) or exists(select 1 from public.game_invites i where i.room_id=id and i.user_id=(select auth.uid())))
);
create policy "Invite recipients only" on public.game_invites for select to authenticated using ((select public.games_access()) and user_id=(select auth.uid()));
create policy "Visible room rosters" on public.game_players for select to authenticated using ((select public.games_access()) and exists(select 1 from public.game_rooms r where r.id=room_id));
create policy "Visible social results" on public.game_results for select to authenticated using ((select public.games_access()) and exists(select 1 from public.game_rooms r where r.id=room_id));

-- Service-role-only transactional API. The web server authenticates the actor and validates game rules.
-- SECURITY INVOKER: these functions confer no privilege to callers.
create function public.games_lobby_command(p_actor uuid,p_room uuid,p_request uuid,p_command text,p_payload jsonb default '{}') returns uuid
language plpgsql security invoker set search_path = '' as $$
declare r public.game_rooms; v_role text; v_name text; v_seat integer; v_id uuid; v_target uuid; v_capacity integer; v_player record;
begin
  if current_user <> 'service_role' then raise exception 'Server only'; end if;
  -- The trusted HTTP layer verifies the actor's staff email via auth.getUser().
  -- Do not depend on service_role having direct SELECT privileges on auth.users.
  select m.role into v_role from public.staff_memberships m
    where m.user_id=p_actor and m.status='active' and m.role in ('ceo','admin');
  if v_role is null then raise exception 'Hub membership required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
  select room_id into v_id from public.game_requests where actor_id=p_actor and request_id=p_request;
  if found then return v_id; end if;
  select nullif(left(p.display_name,100),'') into v_name from public.connect_profiles p where p.user_id=p_actor;
  v_name := coalesce(v_name,upper(v_role) || ' · ' || left(p_actor::text,6));
  if p_command='create' then
    if (select count(*) from public.game_rooms where host_id=p_actor and status<>'finished') >= 20 then raise exception 'Finish or leave an existing room first'; end if;
    v_capacity := (p_payload->>'capacity')::integer;
    if p_payload->>'game' not in ('ludo','chess','checkers','tic-tac-toe','trivia') then raise exception 'Unknown game'; end if;
    if p_payload->>'session' is not null and not exists(select 1 from public.game_nights where id=(p_payload->>'session')::uuid and status='scheduled' and p_payload->>'game'=any(games)) then raise exception 'Session unavailable'; end if;
    insert into public.game_rooms(game,host_id,capacity,visibility,session_id) values(p_payload->>'game',p_actor,v_capacity,coalesce(p_payload->>'visibility','open'),(p_payload->>'session')::uuid) returning * into r;
    insert into public.game_players(room_id,user_id,seat,display_name) values(r.id,p_actor,0,v_name);
  else
    select * into r from public.game_rooms where id=p_room for update;
    if not found then raise exception 'Room unavailable'; end if;
    if p_command='join' then
      if r.visibility='invite' and r.host_id<>p_actor and not exists(select 1 from public.game_invites where room_id=r.id and user_id=p_actor) then raise exception 'Invitation required'; end if;
      if exists(select 1 from public.game_players where room_id=r.id and user_id=p_actor and left_at is null) then
        update public.game_players set last_seen=now() where room_id=r.id and user_id=p_actor;
      else
        if r.status<>'waiting' then raise exception 'Room already started or finished'; end if;
        select s into v_seat from generate_series(0,r.capacity-1) s where not exists(select 1 from public.game_players where room_id=r.id and seat=s and left_at is null) order by s limit 1;
        if v_seat is null then raise exception 'Room is full'; end if;
        insert into public.game_players(room_id,user_id,seat,display_name) values(r.id,p_actor,v_seat,v_name)
          on conflict(room_id,user_id) do update set seat=excluded.seat,display_name=excluded.display_name,last_seen=now(),left_at=null;
        update public.game_rooms set version=version+1,updated_at=now() where id=r.id;
      end if;
    elsif p_command='invite' then
      if r.host_id<>p_actor or r.status<>'waiting' then raise exception 'Only a waiting room host can invite'; end if;
      v_target := (p_payload->>'user')::uuid;
      if not exists(select 1 from public.staff_memberships m where m.user_id=v_target and m.status='active' and m.role in ('ceo','admin')) then raise exception 'Eligible Hub member required'; end if;
      insert into public.game_invites values(r.id,v_target) on conflict do nothing;
    elsif p_command='leave' then
      if not exists(select 1 from public.game_players where room_id=r.id and user_id=p_actor and left_at is null) then raise exception 'Participant required'; end if;
      update public.game_players set left_at=now() where room_id=r.id and user_id=p_actor;
      if r.status='active' then
        r.result := jsonb_build_object('message',v_name || ' left. Match ended without an award.');
        insert into public.game_results(room_id,round,result) values(r.id,r.round,r.result) on conflict do nothing;
        update public.game_rooms set status='finished',result=r.result,version=version+1,updated_at=now() where id=r.id;
      elsif r.status='waiting' then
        v_seat := 0;
        for v_player in select user_id from public.game_players where room_id=r.id and left_at is null order by seat loop
          update public.game_players set seat=v_seat where room_id=r.id and user_id=v_player.user_id;
          v_seat := v_seat+1;
        end loop;
        select user_id into v_target from public.game_players where room_id=r.id and left_at is null order by seat limit 1;
        update public.game_rooms set host_id=coalesce(v_target,host_id),status=case when v_target is null then 'finished' else 'waiting' end,version=version+1,updated_at=now() where id=r.id;
      else
        update public.game_rooms set version=version+1,updated_at=now() where id=r.id;
      end if;
    else raise exception 'Unsupported lobby command'; end if;
  end if;
  insert into public.game_requests(actor_id,request_id,room_id) values(p_actor,p_request,r.id);
  return r.id;
end $$;

create function public.games_commit(p_actor uuid,p_room uuid,p_request uuid,p_version integer,p_state jsonb,p_status text,p_round integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare r public.game_rooms;
begin
  if current_user <> 'service_role' then raise exception 'Server only'; end if;
  if not exists(select 1 from public.staff_memberships m where m.user_id=p_actor and m.status='active' and m.role in ('ceo','admin')) then raise exception 'Hub membership required'; end if;
  select * into r from public.game_rooms where id=p_room for update;
  if not found or not exists(select 1 from public.game_players where room_id=p_room and user_id=p_actor and left_at is null) then raise exception 'Participant required'; end if;
  if exists(select 1 from public.game_requests where actor_id=p_actor and request_id=p_request and room_id=p_room) then return true; end if;
  if r.version<>p_version then return false; end if;
  if p_status not in ('active','finished') or p_round not between r.round and r.round+1 then raise exception 'Invalid transition'; end if;
  insert into public.game_requests(actor_id,request_id,room_id) values(p_actor,p_request,p_room);
  insert into public.game_states(room_id,state) values(p_room,p_state) on conflict(room_id) do update set state=excluded.state;
  update public.game_rooms set status=p_status,round=p_round,result=case when p_status='finished' then coalesce(p_state->'result',result) else null end,version=version+1,updated_at=now() where id=p_room;
  if p_status='finished' then insert into public.game_results(room_id,round,result) values(p_room,p_round,p_state->'result') on conflict do nothing; end if;
  return true;
end $$;
revoke all on function public.games_lobby_command(uuid,uuid,uuid,text,jsonb),public.games_commit(uuid,uuid,uuid,integer,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.games_lobby_command(uuid,uuid,uuid,text,jsonb),public.games_commit(uuid,uuid,uuid,integer,jsonb,text,integer) to service_role;

-- Only safe metadata is published. Questions/answers/state never enter realtime payloads.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_rooms') then
    alter publication supabase_realtime add table public.game_rooms;
  end if;
end $$;
commit;
