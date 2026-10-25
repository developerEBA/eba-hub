-- Provisioning remains a trusted administration operation. No automatic signup grants.
create table public.departments (
 id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz not null default now()
);
create table public.department_memberships (
 department_id uuid not null references public.departments on delete cascade,
 employee_id uuid not null references public.employee_profiles on delete cascade,
 primary key (department_id, employee_id)
);
create index department_memberships_employee_idx on public.department_memberships(employee_id);
create table public.projects (
 id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments,
 name text not null check (length(trim(name)) between 1 and 200), status text not null default 'planning' check (status in ('planning','active','complete','archived')),
 created_by uuid not null references public.employee_profiles, created_at timestamptz not null default now()
);
create index projects_department_idx on public.projects(department_id);
create index projects_creator_idx on public.projects(created_by);
create table public.project_memberships (
 project_id uuid not null references public.projects on delete cascade, employee_id uuid not null references public.employee_profiles on delete cascade,
 primary key(project_id, employee_id)
);
create index project_memberships_employee_idx on public.project_memberships(employee_id);
create table public.tasks (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade,
 title text not null check(length(trim(title)) between 1 and 200), assignee_id uuid references public.employee_profiles,
 status text not null default 'todo' check(status in ('todo','in_progress','complete')), due_at timestamptz, created_at timestamptz not null default now()
);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_assignee_due_idx on public.tasks(assignee_id,due_at);
create table public.conversations (
 id uuid primary key default gen_random_uuid(), title text not null, created_by uuid not null references public.employee_profiles, created_at timestamptz not null default now()
);
create index conversations_creator_idx on public.conversations(created_by);
create table public.conversation_memberships (
 conversation_id uuid not null references public.conversations on delete cascade, employee_id uuid not null references public.employee_profiles on delete cascade,
 primary key(conversation_id,employee_id)
);
create index conversation_memberships_employee_idx on public.conversation_memberships(employee_id);
create table public.messages (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations on delete cascade,
 sender_id uuid not null references public.employee_profiles, body text not null check(length(trim(body)) between 1 and 10000),
 created_at timestamptz not null default now()
);
create index messages_conversation_time_idx on public.messages(conversation_id,created_at);
create index messages_sender_idx on public.messages(sender_id);
create table public.meetings (
 id uuid primary key default gen_random_uuid(), title text not null, organizer_id uuid not null references public.employee_profiles,
 starts_at timestamptz not null, ends_at timestamptz not null, google_event_id text unique, meet_url text,
 check(ends_at > starts_at)
);
create index meetings_organizer_idx on public.meetings(organizer_id);
create table public.meeting_attendees (
 meeting_id uuid not null references public.meetings on delete cascade, employee_id uuid not null references public.employee_profiles on delete cascade,
 primary key(meeting_id,employee_id)
);
create index meeting_attendees_employee_idx on public.meeting_attendees(employee_id);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.employee_profiles on delete cascade,
 title text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create index notifications_recipient_time_idx on public.notifications(recipient_id,created_at);
create table public.recognition (
 id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.employee_profiles,
 recipient_id uuid not null references public.employee_profiles, message text not null check(length(trim(message)) between 1 and 2000),
 created_at timestamptz not null default now(), check(sender_id <> recipient_id)
);
create index recognition_sender_idx on public.recognition(sender_id);
create index recognition_recipient_idx on public.recognition(recipient_id);
-- Fixed search_path, no client-supplied user id, no recursive RLS queries.
create function public.is_employee() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.employee_profiles where id = (select auth.uid()));
$$;
create function public.has_workspace_role(allowed public.workspace_role[]) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.employee_profiles where id = (select auth.uid()) and role = any(allowed));
$$;
create function public.can_read_project(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select public.is_employee() and (public.has_workspace_role(array['admin','management']::public.workspace_role[]) or exists(select 1 from public.project_memberships where project_id=target and employee_id=(select auth.uid())) or exists(select 1 from public.projects p join public.department_memberships d on d.department_id=p.department_id join public.employee_profiles e on e.id=d.employee_id where p.id=target and e.id=(select auth.uid()) and e.role='department_lead'));
$$;
create function public.in_conversation(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.conversation_memberships where conversation_id=target and employee_id=(select auth.uid()));
$$;
create function public.in_meeting(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.meeting_attendees where meeting_id=target and employee_id=(select auth.uid())) or exists(select 1 from public.meetings where id=target and organizer_id=(select auth.uid()));
$$;
revoke all on function public.is_employee(), public.has_workspace_role(public.workspace_role[]), public.can_read_project(uuid), public.in_conversation(uuid), public.in_meeting(uuid) from public;
grant execute on function public.is_employee(), public.has_workspace_role(public.workspace_role[]), public.can_read_project(uuid), public.in_conversation(uuid), public.in_meeting(uuid) to authenticated;
-- Default deny all writes except scoped message and recognition inserts.
do $$ declare t text; begin
 foreach t in array array['departments','department_memberships','projects','project_memberships','tasks','conversations','conversation_memberships','messages','meetings','meeting_attendees','notifications','recognition'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy directory_read on public.employee_profiles for select to authenticated using (public.is_employee());
create policy departments_read on public.departments for select to authenticated using (public.is_employee());
create policy department_members_read on public.department_memberships for select to authenticated using (public.is_employee());
create policy projects_read on public.projects for select to authenticated using (public.can_read_project(id));
create policy project_members_read on public.project_memberships for select to authenticated using(public.can_read_project(project_id));
create policy tasks_read on public.tasks for select to authenticated using(public.can_read_project(project_id));
create policy conversations_read on public.conversations for select to authenticated using(public.in_conversation(id));
create policy conversation_members_read on public.conversation_memberships for select to authenticated using(public.in_conversation(conversation_id));
create policy messages_read on public.messages for select to authenticated using(public.in_conversation(conversation_id));
grant insert on public.messages to authenticated;
create policy messages_insert on public.messages for insert to authenticated with check(sender_id=(select auth.uid()) and public.is_employee() and public.in_conversation(conversation_id));
create policy meetings_read on public.meetings for select to authenticated using(public.in_meeting(id));
create policy attendees_read on public.meeting_attendees for select to authenticated using(public.in_meeting(meeting_id));
create policy notifications_read on public.notifications for select to authenticated using(recipient_id=(select auth.uid()));
create policy recognition_read on public.recognition for select to authenticated using(public.is_employee());
grant insert on public.recognition to authenticated;
create policy recognition_insert on public.recognition for insert to authenticated with check(sender_id=(select auth.uid()) and public.is_employee());
-- Storage stays unprovisioned and Realtime publication stays unchanged until access tests pass.
