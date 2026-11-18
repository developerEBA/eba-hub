-- Server-only integration. No grants or RLS policies for browser roles.
begin;

-- Allow the server to read only the Auth columns used below.
grant usage on schema auth to service_role;

grant select (id, user_id, not_after)
on auth.sessions to service_role;

grant select (id, email)
on auth.users to service_role;

create table public.google_organizer_connection (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 0,
  email text,
  subject text,
  refresh_ciphertext text,
  enabled boolean not null default false,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'revoked', 'error')),
  meet_supported boolean,
  verified_at timestamptz,
  connected_at timestamptz,
  revocation_failed boolean not null default false,
  check (
    not enabled
    or (
      refresh_ciphertext is not null
      and email is not null
      and subject is not null
    )
  )
);

insert into public.google_organizer_connection (singleton)
values (true);

create table public.google_organizer_oauth_states (
  state_hash text primary key,
  browser_hash text not null,
  admin_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  organizer_email text not null,
  version bigint not null,
  verifier_ciphertext text not null,
  nonce text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  saved_at timestamptz
);

alter table public.google_organizer_connection
  enable row level security;

alter table public.google_organizer_oauth_states
  enable row level security;

revoke all
on public.google_organizer_connection,
   public.google_organizer_oauth_states
from public, anon, authenticated;

grant select, insert, update, delete
on public.google_organizer_connection,
   public.google_organizer_oauth_states
to service_role;

-- One transaction for consuming state and compare-and-swap writes.
-- The trusted server passes the verified Supabase session.
-- The database independently checks that the session is still live.
create function public.google_organizer_authorize(
  p_action text,
  p_admin uuid,
  p_session uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.google_organizer_connection;
  s public.google_organizer_oauth_states;
begin
  if not exists (
    select 1
    from auth.sessions se
    join auth.users u on u.id = se.user_id
    join public.staff_memberships m on m.user_id = u.id
    where se.id = p_session
      and se.user_id = p_admin
      and (se.not_after is null or se.not_after > now())
      and m.role = 'admin'
      and m.status = 'active'
      and u.email ~* '^[^@]+@enibrand\.com$'
  ) then
    raise exception 'Google authorization denied';
  end if;

  select *
  into c
  from public.google_organizer_connection
  where singleton
  for update;

  if p_action = 'start' then
    delete from public.google_organizer_oauth_states
    where expires_at < now();

    update public.google_organizer_connection
    set version = version + 1
    where singleton
    returning * into c;

    insert into public.google_organizer_oauth_states (
      state_hash,
      browser_hash,
      admin_id,
      session_id,
      organizer_email,
      version,
      verifier_ciphertext,
      nonce,
      expires_at
    )
    values (
      p_data ->> 'state_hash',
      p_data ->> 'browser_hash',
      p_admin,
      p_session,
      p_data ->> 'email',
      c.version,
      p_data ->> 'verifier',
      p_data ->> 'nonce',
      now() + interval '10 minutes'
    );

    return '{}'::jsonb;

  elsif p_action = 'consume' then
    update public.google_organizer_oauth_states
    set consumed_at = now()
    where state_hash = p_data ->> 'state_hash'
      and browser_hash = p_data ->> 'browser_hash'
      and admin_id = p_admin
      and session_id = p_session
      and consumed_at is null
      and expires_at > now()
      and version = c.version
    returning * into s;

    if not found then
      raise exception 'Invalid Google authorization state';
    end if;

    return to_jsonb(s);

  elsif p_action = 'save' then
    select *
    into s
    from public.google_organizer_oauth_states
    where state_hash = p_data ->> 'state_hash'
      and admin_id = p_admin
      and session_id = p_session
      and consumed_at is not null
      and saved_at is null
      and expires_at > now()
      and organizer_email = p_data ->> 'email'
      and version = c.version
    for update;

    if not found then
      raise exception 'Invalid Google authorization state';
    end if;

    update public.google_organizer_connection
    set
      email = p_data ->> 'email',
      subject = p_data ->> 'subject',
      refresh_ciphertext = p_data ->> 'ciphertext',
      enabled = true,
      status = 'connected',
      meet_supported = (p_data ->> 'meet_supported')::boolean,
      verified_at = now(),
      connected_at = now(),
      revocation_failed = false,
      version = version + 1
    where singleton;

    update public.google_organizer_oauth_states
    set
      saved_at = now(),
      verifier_ciphertext = ''
    where state_hash = s.state_hash;

    return '{}'::jsonb;

  elsif p_action = 'disconnect' then
    update public.google_organizer_connection
    set
      enabled = false,
      status = 'disconnected',
      refresh_ciphertext = null,
      meet_supported = null,
      verified_at = null,
      version = version + 1,
      revocation_failed = false
    where singleton;

    delete from public.google_organizer_oauth_states;

    -- Only service_role can receive the old encrypted token.
    return to_jsonb(c);
  end if;

  raise exception 'Unknown Google authorization action';
end;
$$;

revoke all
on function public.google_organizer_authorize(text, uuid, uuid, jsonb)
from public, anon, authenticated;

grant execute
on function public.google_organizer_authorize(text, uuid, uuid, jsonb)
to service_role;

notify pgrst, 'reload schema';

commit;