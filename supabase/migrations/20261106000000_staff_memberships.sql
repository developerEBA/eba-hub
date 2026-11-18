begin;

create table public.staff_memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('ceo', 'admin', 'staff')),
  status text not null default 'inactive' check (status in ('active', 'inactive'))
);

alter table public.staff_memberships enable row level security;

revoke all on table public.staff_memberships from public, anon, authenticated;
grant select on table public.staff_memberships to authenticated;

create policy "Staff can read their own membership"
  on public.staff_memberships
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

commit;
