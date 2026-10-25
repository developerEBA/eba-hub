-- No seed data or automatic employee provisioning. Apply through Supabase CLI.
create type public.workspace_role as enum ('employee', 'admin');

create table public.employee_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  role public.workspace_role not null default 'employee',
  created_at timestamptz not null default now()
);

alter table public.employee_profiles enable row level security;
revoke all on public.employee_profiles from anon, authenticated;
grant select on public.employee_profiles to authenticated;

create policy "Employees can read their own profile"
  on public.employee_profiles for select to authenticated
  using ((select auth.uid()) = id);

-- Provisioning and role changes require an approved server-side administration
-- flow. No client insert/update/delete grants or policies are intentionally given.
