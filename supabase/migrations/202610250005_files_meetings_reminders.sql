-- Attachments are authorized by owner or explicit conversation membership.
create table public.workspace_files(id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.employee_profiles,conversation_id uuid references public.conversations on delete cascade,path text not null unique,name text not null check(length(name) between 1 and 180),mime_type text not null,size_bytes integer not null check(size_bytes between 1 and 4194304),created_at timestamptz not null default now());
create index files_owner_idx on public.workspace_files(owner_id);create index files_conversation_idx on public.workspace_files(conversation_id);
alter table public.workspace_files enable row level security;revoke all on public.workspace_files from anon,authenticated;grant select,insert on public.workspace_files to authenticated;
create policy files_read on public.workspace_files for select to authenticated using(owner_id=auth.uid() or public.in_conversation(conversation_id));
create policy files_insert on public.workspace_files for insert to authenticated with check(owner_id=auth.uid() and public.is_employee() and split_part(path,'/',1)=auth.uid()::text and (conversation_id is null or public.in_conversation(conversation_id)));
alter table public.messages add column attachment_id uuid references public.workspace_files;
alter table public.messages add column kind text not null default 'text' check(kind in ('text','voice','file','sticker'));
create index messages_attachment_idx on public.messages(attachment_id);
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check(sender_id=auth.uid() and public.is_employee() and public.in_conversation(conversation_id) and ((attachment_id is null and kind in ('text','sticker')) or exists(select 1 from public.workspace_files f where f.id=attachment_id and f.owner_id=auth.uid() and f.conversation_id=messages.conversation_id and (kind='file' or (kind='voice' and f.mime_type in ('audio/webm','audio/ogg','audio/mp4'))))));

create function public.schedule_workspace_meeting(meeting_title text,start_time timestamptz,end_time timestamptz,attendees uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 if not public.is_employee() then raise exception 'Forbidden' using errcode='42501';end if;
 if length(trim(meeting_title)) not between 1 and 200 or start_time is null or end_time is null or start_time>=end_time or cardinality(attendees)>100 then raise exception 'Invalid meeting';end if;
 if exists(select 1 from unnest(attendees) a where not exists(select 1 from public.employee_profiles where id=a)) then raise exception 'Invalid attendee';end if;
 insert into public.meetings(title,organizer_id,starts_at,ends_at) values(trim(meeting_title),auth.uid(),start_time,end_time) returning id into result;
 insert into public.meeting_attendees(meeting_id,employee_id) select result,member from (select distinct unnest(array_append(coalesce(attendees,'{}'),auth.uid())) member) s;
 insert into public.notifications(recipient_id,title) select employee_id,'Meeting invitation: '||meeting_title from public.meeting_attendees where meeting_id=result;
 return result;
end $$;
create function public.update_meeting_attendees(meeting uuid,attendees uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_employee() or not exists(select 1 from public.meetings where id=meeting and organizer_id=auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if cardinality(attendees)>100 or exists(select 1 from unnest(attendees) a where not exists(select 1 from public.employee_profiles where id=a)) then raise exception 'Invalid attendee';end if;
 delete from public.meeting_attendees where meeting_id=meeting;
 insert into public.meeting_attendees(meeting_id,employee_id) select meeting,member from(select distinct unnest(array_append(attendees,auth.uid())) member)s;
end $$;
grant update(title,starts_at,ends_at) on public.meetings to authenticated;
create policy meetings_update on public.meetings for update to authenticated using(organizer_id=auth.uid()) with check(organizer_id=auth.uid());
revoke all on function public.schedule_workspace_meeting(text,timestamptz,timestamptz,uuid[]),public.update_meeting_attendees(uuid,uuid[]) from public;
grant execute on function public.schedule_workspace_meeting(text,timestamptz,timestamptz,uuid[]),public.update_meeting_attendees(uuid,uuid[]) to authenticated;

-- Durable in-app delivery. The job runner is not exposed to ordinary users.
create table public.reminder_jobs(id uuid primary key default gen_random_uuid(),task_id uuid not null references public.tasks on delete cascade,recipient_id uuid not null references public.employee_profiles,run_at timestamptz not null,state text not null default 'pending' check(state in ('pending','delivered','failed','cancelled')),attempts integer not null default 0,last_error text,delivered_at timestamptz,unique(task_id,recipient_id));
create index reminder_pending_idx on public.reminder_jobs(run_at) where state='pending';create index reminder_recipient_idx on public.reminder_jobs(recipient_id);
alter table public.reminder_jobs enable row level security;revoke all on public.reminder_jobs from anon,authenticated;grant select on public.reminder_jobs to authenticated;
create policy own_reminders on public.reminder_jobs for select to authenticated using(recipient_id=auth.uid());
alter table public.notifications add column reminder_job_id uuid unique references public.reminder_jobs on delete set null;
create function public.sync_task_reminder() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if TG_OP='UPDATE' then
 if new.due_at is not distinct from old.due_at and new.assignee_id is not distinct from old.assignee_id and new.status is not distinct from old.status then return new;end if;
 end if;
 update public.reminder_jobs set state='cancelled' where task_id=new.id and state='pending';
 if new.due_at is not null and new.assignee_id is not null and new.status<>'complete' then
 insert into public.reminder_jobs(task_id,recipient_id,run_at) values(new.id,new.assignee_id,new.due_at-interval '15 minutes') on conflict(task_id,recipient_id) do update set run_at=excluded.run_at,state='pending',attempts=0,last_error=null,delivered_at=null;
 end if;return new;
end $$;
create trigger task_reminder after insert or update of due_at,assignee_id,status on public.tasks for each row execute function public.sync_task_reminder();
create function public.deliver_due_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare job public.reminder_jobs;delivered integer:=0;begin
 for job in select * from public.reminder_jobs where state='pending' and run_at<=now() order by run_at for update skip locked limit 100 loop
 begin
 if not exists(select 1 from public.tasks t join public.project_memberships pm on pm.project_id=t.project_id join public.employee_profiles ep on ep.id=job.recipient_id and ep.is_active where t.id=job.task_id and t.status<>'complete' and t.assignee_id=job.recipient_id and pm.employee_id=job.recipient_id) then update public.reminder_jobs set state='cancelled' where id=job.id;continue;end if;
 insert into public.notifications(recipient_id,title,reminder_job_id) select job.recipient_id,'Task due soon: '||title,job.id from public.tasks where id=job.task_id on conflict(reminder_job_id) do update set read_at=null,title=excluded.title,created_at=now();
 update public.reminder_jobs set state='delivered',delivered_at=now(),attempts=attempts+1,last_error=null where id=job.id;delivered:=delivered+1;
 exception when others then
 update public.reminder_jobs set attempts=attempts+1,state=case when attempts+1>=5 then 'failed' else 'pending' end,last_error=SQLSTATE,run_at=now()+interval '1 minute'*power(2,least(attempts,5)) where id=job.id;
 end;
 end loop;return delivered;
end $$;
revoke all on function public.sync_task_reminder(),public.deliver_due_reminders() from public;
grant execute on function public.deliver_due_reminders() to service_role;
-- A restrictive gate composes with every row policy, including legacy policies.
do $$ declare t text;begin
 foreach t in array array['employee_profiles','departments','department_memberships','projects','project_memberships','tasks','conversations','conversation_memberships','messages','meetings','meeting_attendees','notifications','recognition','focus_items','announcements','approvals','leave_requests','award_periods','nominations','activity_events','workspace_files','reminder_jobs'] loop
 execute format('create policy active_employee_gate on public.%I as restrictive for all to authenticated using(public.is_employee()) with check(public.is_employee())',t);
 end loop;
end $$;



