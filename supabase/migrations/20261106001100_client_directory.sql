begin;

create table public.client_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '[^[:space:]]' and length(name) <= 160),
  primary_contact text check (length(primary_contact) <= 120),
  email text check (
    length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  phone text check (
    length(phone) <= 40 and phone ~ '^[+0-9(). -]+$' and phone ~ '[0-9]'
  ),
  notes text check (length(notes) <= 4000)
);

create index client_directory_name_order_idx on public.client_directory (lower(name), id);

alter table public.client_directory enable row level security;
revoke all on public.client_directory from public, anon, authenticated;
grant select on public.client_directory to authenticated;
grant insert (name, primary_contact, email, phone, notes),
  update (name, primary_contact, email, phone, notes)
  on public.client_directory to authenticated;

create function eba_private.client_directory_can_write()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select eba_private.hub_is_active() and exists (
    select 1 from public.staff_memberships
    where user_id = (select auth.uid()) and role = 'admin' and status = 'active'
  );
$$;
revoke all on function eba_private.client_directory_can_write() from public, anon, authenticated;
grant execute on function eba_private.client_directory_can_write() to authenticated;

create policy "Active executives read the client directory"
  on public.client_directory for select to authenticated
  using ((select eba_private.hub_is_active()));

create policy "Active Admins add clients"
  on public.client_directory for insert to authenticated
  with check ((select eba_private.client_directory_can_write()));

create policy "Active Admins edit clients"
  on public.client_directory for update to authenticated
  using ((select eba_private.client_directory_can_write()))
  with check ((select eba_private.client_directory_can_write()));

create function public.search_client_directory(p_query text, p_offset integer)
returns table (id uuid, name text, primary_contact text)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.name, c.primary_contact
  from public.client_directory c
  where coalesce(p_query, '') = ''
    or strpos(lower(c.name), lower(left(p_query, 160))) > 0
    or strpos(lower(coalesce(c.primary_contact, '')), lower(left(p_query, 160))) > 0
  order by lower(c.name), c.id
  limit 26 offset greatest(0, least(coalesce(p_offset, 0), 250000));
$$;

revoke all on function public.search_client_directory(text, integer) from public, anon, authenticated;
grant execute on function public.search_client_directory(text, integer) to authenticated;

commit;
