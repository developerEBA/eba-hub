begin;

create schema if not exists eba_private;
revoke all on schema eba_private from public, anon, authenticated;
grant usage on schema eba_private to authenticated;

create function eba_private.can_review_approvals()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select coalesce(lower(auth.jwt() ->> 'email') ~ '^[^@]+@enibrand[.]com$', false)
    and exists (
      select 1 from public.staff_memberships
      where user_id = (select auth.uid()) and status = 'active' and role in ('ceo', 'admin')
    );
$$;
revoke all on function eba_private.can_review_approvals() from public, anon, authenticated;
grant execute on function eba_private.can_review_approvals() to authenticated;

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  request_type text not null check (request_type in ('graphics', 'marketing', 'website', 'leave', 'sick', 'absence')),
  department text not null,
  requester_name text not null,
  submitted_at timestamptz not null default now(),
  message text not null,
  external_url text,
  start_date date,
  end_date date,
  attachment_names text[] not null default '{}',
  department_plan_id uuid references public.department_plans(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested', 'rejected')),
  reviewer_id uuid references auth.users(id),
  reviewer_email text,
  decided_at timestamptz,
  decision_note text,
  check (request_type not in ('leave', 'sick', 'absence') or
    (start_date is not null and end_date is not null and end_date >= start_date)),
  check (request_type <> 'leave' or cardinality(attachment_names) > 0),
  check (
    (status = 'pending' and reviewer_id is null and reviewer_email is null and decided_at is null and decision_note is null)
    or (status <> 'pending' and reviewer_id is not null and reviewer_email is not null and decided_at is not null)
  ),
  check (status <> 'changes_requested' or nullif(trim(decision_note), '') is not null)
);

create index approval_requests_submitted_at_idx on public.approval_requests (submitted_at desc, id);
create index approval_requests_department_plan_idx on public.approval_requests (department_plan_id);

alter table public.approval_requests enable row level security;
revoke all on public.approval_requests from public, anon, authenticated;
grant select on public.approval_requests to authenticated;
create policy "Active staff reviewers read approval requests"
  on public.approval_requests for select to authenticated
  using ((select eba_private.can_review_approvals()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('approval-request-files', 'approval-request-files', false, 10485760);

create policy "Active staff reviewers read linked approval files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'approval-request-files'
    and (select eba_private.can_review_approvals())
    and exists (
      select 1 from public.approval_requests as request
      where request.id::text = split_part(storage.objects.name, '/', 1)
        and storage.objects.name = request.id::text || '/' || split_part(storage.objects.name, '/', 2)
        and split_part(storage.objects.name, '/', 2) = any(request.attachment_names)
    )
  );

create function eba_private.decide_approval(request_id uuid, decision text, note text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  clean_note text := nullif(btrim(note, E' \t\r\n'), '');
begin
  if not eba_private.can_review_approvals() then
    raise insufficient_privilege using message = 'Review access denied';
  end if;
  if decision is null or decision not in ('approved', 'changes_requested', 'rejected')
     or (decision = 'changes_requested' and clean_note is null)
     or length(clean_note) > 2000 then
    raise invalid_parameter_value using message = 'Invalid approval decision';
  end if;

  update public.approval_requests as request
  set status = decision,
      reviewer_id = auth.uid(),
      reviewer_email = auth.jwt() ->> 'email',
      decided_at = statement_timestamp(),
      decision_note = case when decision = 'approved' then null else clean_note end
  where request.id = request_id and request.status = 'pending'
    and (request.request_type <> 'leave' or exists (
      select 1 from storage.objects as file
      where file.bucket_id = 'approval-request-files'
        and split_part(file.name, '/', 2) = any(request.attachment_names)
        and file.name = request.id::text || '/' || split_part(file.name, '/', 2)
    ));
  if found then return 'saved'; end if;
  if exists (
    select 1 from public.approval_requests where id = request_id and status <> 'pending'
  ) then return 'decided'; end if;
  return 'unavailable';
end;
$$;

create function public.decide_approval(request_id uuid, decision text, note text)
returns text language sql security invoker set search_path = ''
as $$ select eba_private.decide_approval(request_id, decision, note); $$;

revoke all on function eba_private.decide_approval(uuid, text, text) from public, anon, authenticated;
revoke all on function public.decide_approval(uuid, text, text) from public, anon, authenticated;
grant execute on function eba_private.decide_approval(uuid, text, text) to authenticated;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

commit;
