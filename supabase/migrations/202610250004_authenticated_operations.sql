-- Deactivation is a stored authorization property, not a frontend preference.
alter table public.employee_profiles add column is_active boolean not null default true;
create or replace function public.is_employee() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.employee_profiles where id=auth.uid() and is_active); $$;
create or replace function public.has_workspace_role(allowed public.workspace_role[]) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.employee_profiles where id=auth.uid() and is_active and role=any(allowed)); $$;
-- Core authenticated operations. Apply only to the approved isolated project first.
alter table public.projects add column deadline timestamptz;
alter table public.tasks add column priority text not null default 'medium' check(priority in ('low','medium','high'));
alter table public.tasks add column created_by uuid references public.employee_profiles;
alter table public.tasks add column updated_at timestamptz not null default now();
alter table public.conversations add column kind text not null default 'channel' check(kind in ('channel','private'));
alter table public.conversation_memberships add column last_read_at timestamptz not null default '1970-01-01Z';

create function public.can_manage_project(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_workspace_role(array['admin','management']::public.workspace_role[]) or exists(select 1 from public.projects p join public.department_memberships d on d.department_id=p.department_id where p.id=target and d.employee_id=(select auth.uid()) and public.has_workspace_role(array['department_lead']::public.workspace_role[]));
$$;
create function public.project_employee(target uuid, employee uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.project_memberships where project_id=target and employee_id=employee);
$$;
-- No client may change task ownership/project or assign an outsider through an update.
grant insert, delete on public.tasks to authenticated;
grant update(title,status,priority,due_at,assignee_id,updated_at) on public.tasks to authenticated;
create policy tasks_insert on public.tasks for insert to authenticated with check(public.can_read_project(project_id) and created_by=(select auth.uid()) and (assignee_id is null or public.project_employee(project_id,assignee_id)));
create policy tasks_update on public.tasks for update to authenticated using(public.can_read_project(project_id) and (assignee_id=(select auth.uid()) or created_by=(select auth.uid()) or public.can_manage_project(project_id))) with check(public.can_read_project(project_id) and (assignee_id is null or public.project_employee(project_id,assignee_id)));
create policy tasks_delete on public.tasks for delete to authenticated using(public.can_manage_project(project_id) or created_by=(select auth.uid()));
grant update(name,status,deadline) on public.projects to authenticated;
create policy projects_update on public.projects for update to authenticated using(public.can_manage_project(id)) with check(public.can_manage_project(id));

create function public.create_workspace_project(project_name text, department uuid, due timestamptz, members uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; begin
 if not(public.has_workspace_role(array['admin','management']::public.workspace_role[]) or (public.has_workspace_role(array['department_lead']::public.workspace_role[]) and exists(select 1 from public.department_memberships where department_id=department and employee_id=auth.uid()))) then raise exception 'Forbidden' using errcode='42501'; end if;
 if length(trim(project_name)) not between 1 and 200 then raise exception 'Invalid project name'; end if;
 if exists(select 1 from unnest(members) m where not exists(select 1 from public.department_memberships where department_id=department and employee_id=m)) then raise exception 'Participants must belong to the department'; end if;
 insert into public.projects(name,department_id,created_by,deadline) values(trim(project_name),department,auth.uid(),due) returning id into result;
 insert into public.project_memberships(project_id,employee_id) select result, member from (select distinct unnest(array_append(coalesce(members,'{}'),auth.uid())) member) s;
 return result;
end $$;
create function public.set_project_members(project uuid, members uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare department uuid; begin
 if not public.can_manage_project(project) then raise exception 'Forbidden' using errcode='42501'; end if;
 select department_id into department from public.projects where id=project for update;
 if exists(select 1 from unnest(members) m where not exists(select 1 from public.department_memberships where department_id=department and employee_id=m)) then raise exception 'Participants must belong to the department'; end if;
 if exists(select 1 from public.tasks where project_id=project and assignee_id is not null and not (assignee_id=any(array_append(members,auth.uid())))) then raise exception 'Reassign tasks before removing their assignee'; end if;
 delete from public.project_memberships where project_id=project;
 insert into public.project_memberships(project_id,employee_id) select project, member from (select distinct unnest(array_append(members,auth.uid())) member) s;
end $$;
create function public.create_workspace_conversation(conversation_title text, conversation_kind text, members uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; begin
 if not public.is_employee() then raise exception 'Forbidden' using errcode='42501'; end if;
 if members is null or cardinality(members)<1 or conversation_kind not in ('channel','private') or length(trim(conversation_title)) not between 1 and 120 then raise exception 'Invalid conversation'; end if;
 if conversation_kind='private' and cardinality(members)<>1 then raise exception 'Private chats require one recipient'; end if;
 if cardinality(members)>100 or exists(select 1 from unnest(members) m where m=auth.uid() or not exists(select 1 from public.employee_profiles where id=m)) then raise exception 'Invalid participants'; end if;
 insert into public.conversations(title,created_by,kind) values(trim(conversation_title),auth.uid(),conversation_kind) returning id into result;
 insert into public.conversation_memberships(conversation_id,employee_id) select result,member from (select distinct unnest(array_append(coalesce(members,'{}'),auth.uid())) member) s;
 return result;
end $$;
grant update(last_read_at) on public.conversation_memberships to authenticated;
create policy read_cursor_update on public.conversation_memberships for update to authenticated using(employee_id=(select auth.uid())) with check(employee_id=(select auth.uid()));

create table public.focus_items(id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employee_profiles on delete cascade,title text not null check(length(trim(title)) between 1 and 200), complete boolean not null default false, created_at timestamptz not null default now());
create index focus_employee_idx on public.focus_items(employee_id);
alter table public.focus_items enable row level security;
revoke all on public.focus_items from anon,authenticated; grant select,insert,delete on public.focus_items to authenticated; grant update(title,complete) on public.focus_items to authenticated;
create policy own_focus on public.focus_items for all to authenticated using(employee_id=(select auth.uid())) with check(employee_id=(select auth.uid()) and public.is_employee());

create table public.announcements(id uuid primary key default gen_random_uuid(),author_id uuid not null references public.employee_profiles,title text not null check(length(trim(title)) between 1 and 200),body text not null check(length(trim(body)) between 1 and 5000),created_at timestamptz not null default now());
create index announcements_author_idx on public.announcements(author_id);
alter table public.announcements enable row level security; revoke all on public.announcements from anon,authenticated; grant select,insert,delete on public.announcements to authenticated;
create policy announcements_read on public.announcements for select to authenticated using(public.is_employee());
create policy announcements_insert on public.announcements for insert to authenticated with check(author_id=auth.uid() and public.has_workspace_role(array['management','admin']::public.workspace_role[]));
create policy announcements_delete on public.announcements for delete to authenticated using(public.has_workspace_role(array['management','admin']::public.workspace_role[]));

grant update(display_name) on public.employee_profiles to authenticated;
create policy own_profile_name on public.employee_profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
grant update(read_at) on public.notifications to authenticated;
create policy notification_read_marker on public.notifications for update to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());

create table public.approvals(id uuid primary key default gen_random_uuid(),requester_id uuid not null references public.employee_profiles,title text not null check(length(trim(title)) between 1 and 200),body text not null check(length(trim(body)) between 1 and 3000),kind text not null default 'general' check(kind in ('general','leave','nomination')),status text not null default 'pending' check(status in ('pending','approved','rejected')),reviewer_id uuid references public.employee_profiles,reviewed_at timestamptz,created_at timestamptz not null default now());
create index approvals_requester_idx on public.approvals(requester_id); create index approvals_reviewer_idx on public.approvals(reviewer_id); create index approvals_status_idx on public.approvals(status);
alter table public.approvals enable row level security; revoke all on public.approvals from anon,authenticated; grant select,insert on public.approvals to authenticated;
create policy approvals_read on public.approvals for select to authenticated using(requester_id=auth.uid() or public.has_workspace_role(array['management','admin']::public.workspace_role[]));
create policy approvals_submit on public.approvals for insert to authenticated with check(public.is_employee() and requester_id=auth.uid() and kind='general' and status='pending' and reviewer_id is null and reviewed_at is null);
create table public.leave_requests(id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employee_profiles,approval_id uuid not null unique references public.approvals,starts_on date not null,ends_on date not null,check(ends_on>=starts_on));
create index leave_employee_idx on public.leave_requests(employee_id);
alter table public.leave_requests enable row level security; revoke all on public.leave_requests from anon,authenticated;grant select on public.leave_requests to authenticated;
create policy leaves_read on public.leave_requests for select to authenticated using(employee_id=auth.uid() or public.has_workspace_role(array['management','admin']::public.workspace_role[]));
create function public.submit_leave(start_date date,end_date date,reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; begin
 if not public.is_employee() then raise exception 'Forbidden' using errcode='42501'; end if;
 if start_date is null or end_date is null or end_date<start_date or length(trim(reason)) not between 1 and 3000 then raise exception 'Invalid leave request'; end if;
 insert into public.approvals(requester_id,title,body,kind) values(auth.uid(),'Leave request',trim(reason),'leave') returning id into result;
 insert into public.leave_requests(employee_id,approval_id,starts_on,ends_on) values(auth.uid(),result,start_date,end_date); return result;
end $$;
create table public.award_periods(id uuid primary key default gen_random_uuid(),title text not null,starts_on date not null,ends_on date not null,check(ends_on>=starts_on));
create table public.nominations(id uuid primary key default gen_random_uuid(),period_id uuid not null references public.award_periods,nominee_id uuid not null references public.employee_profiles,nominator_id uuid not null references public.employee_profiles,approval_id uuid not null unique references public.approvals,unique(period_id,nominee_id,nominator_id),check(nominee_id<>nominator_id));
create index nominations_nominee_idx on public.nominations(nominee_id);create index nominations_nominator_idx on public.nominations(nominator_id);
alter table public.award_periods enable row level security;alter table public.nominations enable row level security;
revoke all on public.award_periods,public.nominations from anon,authenticated;grant select on public.award_periods,public.nominations to authenticated; grant insert on public.award_periods to authenticated;
create policy periods_read on public.award_periods for select to authenticated using(public.is_employee());
create policy periods_create on public.award_periods for insert to authenticated with check(public.has_workspace_role(array['management','admin']::public.workspace_role[]));
create policy nominations_read on public.nominations for select to authenticated using(nominator_id=auth.uid() or public.has_workspace_role(array['management','admin']::public.workspace_role[]));
create function public.submit_nomination(period uuid,nominee uuid,reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 if not public.is_employee() or nominee=auth.uid() then raise exception 'Forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.award_periods where id=period and current_date between starts_on and ends_on) or length(trim(reason)) not between 1 and 2000 then raise exception 'Invalid nomination period or reason';end if;
 insert into public.approvals(requester_id,title,body,kind) values(auth.uid(),'Employee nomination',reason,'nomination') returning id into result;
 insert into public.nominations(period_id,nominee_id,nominator_id,approval_id) values(period,nominee,auth.uid(),result);return result;
end $$;
create function public.review_approval(target uuid,decision text) returns void language plpgsql security definer set search_path='' as $$
declare item public.approvals;begin
 if not public.has_workspace_role(array['management','admin']::public.workspace_role[]) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into item from public.approvals where id=target for update;
 if not found or item.status<>'pending' or item.requester_id=auth.uid() or decision not in ('approved','rejected') then raise exception 'Invalid review or self approval';end if;
 -- A nominee cannot approve their own nomination, even if they are management.
 if exists(select 1 from public.nominations where approval_id=target and nominee_id=auth.uid()) then raise exception 'Cannot approve your own nomination';end if;
 update public.approvals set status=decision,reviewer_id=auth.uid(),reviewed_at=now() where id=target;
 if decision='approved' and item.kind='nomination' then
 insert into public.recognition(sender_id,recipient_id,message) select nominator_id,nominee_id,item.body from public.nominations where approval_id=target;
 end if;
 insert into public.notifications(recipient_id,title) values(item.requester_id,item.title||': '||decision);
end $$;
-- Recognition is now management-approved; remove the earlier direct appreciation insert grant.
revoke insert on public.recognition from authenticated;

create table public.activity_events(id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.employee_profiles,event text not null,created_at timestamptz not null default now());
create index activity_actor_time_idx on public.activity_events(actor_id,created_at);
alter table public.activity_events enable row level security;revoke all on public.activity_events from anon,authenticated;grant select on public.activity_events to authenticated;
create policy activity_read on public.activity_events for select to authenticated using(actor_id=auth.uid() or public.has_workspace_role(array['management','admin']::public.workspace_role[]));
create function public.record_workspace_activity() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is not null then insert into public.activity_events(actor_id,event) values(auth.uid(),TG_TABLE_NAME||' '||lower(TG_OP));end if;return new;
end $$;
create trigger tasks_activity after insert or update on public.tasks for each row execute function public.record_workspace_activity();
create trigger projects_activity after insert or update on public.projects for each row execute function public.record_workspace_activity();
create trigger approval_activity after insert or update on public.approvals for each row execute function public.record_workspace_activity();

create function public.workspace_counts() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('projects',(select count(*) from public.projects where status='active'),'tasks',(select count(*) from public.tasks where assignee_id=auth.uid() and status<>'complete'),'meetings',(select count(*) from public.meetings where ends_at>=now()),'messages',(select count(*) from public.messages m join public.conversation_memberships cm on cm.conversation_id=m.conversation_id and cm.employee_id=auth.uid() where m.sender_id<>auth.uid() and m.created_at>cm.last_read_at),'notifications',(select count(*) from public.notifications where read_at is null),'approvals',(select count(*) from public.approvals where status='pending'));
$$;
-- Explicitly revoke default PUBLIC execution for every new privileged entry point.
revoke all on function public.can_manage_project(uuid),public.project_employee(uuid,uuid),public.create_workspace_project(text,uuid,timestamptz,uuid[]),public.set_project_members(uuid,uuid[]),public.create_workspace_conversation(text,text,uuid[]),public.submit_leave(date,date,text),public.submit_nomination(uuid,uuid,text),public.review_approval(uuid,text),public.workspace_counts(),public.record_workspace_activity() from public;
grant execute on function public.can_manage_project(uuid),public.project_employee(uuid,uuid),public.create_workspace_project(text,uuid,timestamptz,uuid[]),public.set_project_members(uuid,uuid[]),public.create_workspace_conversation(text,text,uuid[]),public.submit_leave(date,date,text),public.submit_nomination(uuid,uuid,text),public.review_approval(uuid,text),public.workspace_counts() to authenticated;
create view public.project_delivery with(security_invoker=true) as
 select p.id as project_id,count(t.id)::integer as total,count(t.id) filter(where t.status='complete')::integer as completed,
 case when count(t.id)=0 then 0 else round(100.0*count(t.id) filter(where t.status='complete')/count(t.id))::integer end as progress
 from public.projects p left join public.tasks t on t.project_id=p.id group by p.id;
grant select on public.project_delivery to authenticated;

create view public.conversation_delivery with(security_invoker=true) as
 select c.id,count(m.id)::integer as unread_count from public.conversations c
 join public.conversation_memberships cm on cm.conversation_id=c.id and cm.employee_id=auth.uid()
 left join public.messages m on m.conversation_id=c.id and m.sender_id<>auth.uid() and m.created_at>cm.last_read_at
 group by c.id;
grant select on public.conversation_delivery to authenticated;
