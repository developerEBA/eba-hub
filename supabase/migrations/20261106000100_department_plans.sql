begin;

create table public.department_plans (
  id uuid primary key default gen_random_uuid(),
  department text not null check (department in ('graphics', 'development', 'communications', 'events', 'marketing')),
  period_kind text not null check (period_kind in ('week', 'month', 'year')),
  period_start date not null,
  title text not null check (length(trim(title)) > 0),
  summary text not null default '',
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  unique (department, period_kind, period_start),
  check (
    (period_kind = 'week' and extract(isodow from period_start) = 1)
    or (period_kind = 'month' and extract(day from period_start) = 1)
    or (period_kind = 'year' and extract(doy from period_start) = 1)
  )
);

create table public.department_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.department_plans (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  owner text not null check (length(trim(owner)) > 0),
  due_date date,
  status text not null check (length(trim(status)) > 0)
);

create table public.department_plan_attachments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.department_plans (id) on delete cascade,
  filename text not null check (length(trim(filename)) between 1 and 255),
  object_path text not null unique,
  check (split_part(object_path, '/', 1) = plan_id::text and split_part(object_path, '/', 2) <> '')
);

create index department_plan_items_plan_id_idx on public.department_plan_items (plan_id);
create index department_plan_attachments_plan_id_idx on public.department_plan_attachments (plan_id);

alter table public.department_plans enable row level security;
alter table public.department_plan_items enable row level security;
alter table public.department_plan_attachments enable row level security;

revoke all on table public.department_plans, public.department_plan_items, public.department_plan_attachments
  from public, anon, authenticated;
grant select on table public.department_plans, public.department_plan_items, public.department_plan_attachments
  to authenticated;

create policy "Active CEOs can read submitted plans"
  on public.department_plans for select to authenticated
  using (
    status = 'submitted'
    and lower((select auth.jwt()) ->> 'email') ~ '^[^@]+@enibrand[.]com$'
    and exists (
      select 1 from public.staff_memberships as member
      where member.user_id = (select auth.uid())
        and member.role = 'ceo'
        and member.status = 'active'
    )
  );

create policy "Read items on visible plans"
  on public.department_plan_items for select to authenticated
  using (exists (select 1 from public.department_plans as plan where plan.id = plan_id));

create policy "Read attachment metadata on visible plans"
  on public.department_plan_attachments for select to authenticated
  using (exists (select 1 from public.department_plans as plan where plan.id = plan_id));

insert into storage.buckets (id, name, public)
values ('department-plan-files', 'department-plan-files', false);

create policy "Read files on visible plans"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'department-plan-files'
    and exists (
      select 1 from public.department_plan_attachments as attachment
      where attachment.object_path = storage.objects.name
    )
  );

commit;
