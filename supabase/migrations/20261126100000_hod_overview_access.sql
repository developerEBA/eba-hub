begin;

-- Keep HOD approval reads and uploads inside current assigned departments.
-- HOD department queues use a separate summary RPC with no message or file data.
drop policy if exists "HODs read only their own submitted requests" on public.approval_requests;
create policy "HODs read only their own submitted requests" on public.approval_requests for select to authenticated
  using (requester_id=auth.uid() and eba_private.hod_in_department(auth.uid(),department));

drop policy if exists "HODs submit requests for themselves" on public.approval_requests;
create policy "HODs submit requests for themselves" on public.approval_requests for insert to authenticated
  with check (requester_id=auth.uid() and reviewer_id is null and reviewer_email is null and decided_at is null
    and decision_note is null and status='pending' and eba_private.hod_in_department(auth.uid(),department));

drop policy if exists "HODs read only their own approval documents" on storage.objects;
create policy "HODs read only their own assigned department approval documents" on storage.objects for select to authenticated
  using (bucket_id='approval-request-files' and exists(
    select 1 from public.approval_requests r where r.requester_id=auth.uid()
      and eba_private.hod_in_department(auth.uid(),r.department)
      and r.id::text=split_part(storage.objects.name,'/',1)
      and storage.objects.name=r.id::text||'/'||split_part(storage.objects.name,'/',2)
      and split_part(storage.objects.name,'/',2)=any(r.attachment_names)
  ));

-- HODs see a small pending queue for current assigned departments, but receive
-- no request IDs, messages, leave details, decision notes, or attachment names.
create or replace function public.hod_department_approval_summary()
returns jsonb language sql stable security definer set search_path='' as $$
  with authorized as (
    select auth.uid() as user_id where eba_private.hod_dashboard_member(auth.uid())
  ), assigned as (
    select a.department from public.staff_department_assignments a join authorized x on x.user_id=a.user_id
  ), pending as (
    select r.request_type,r.department,r.submitted_at,r.status
    from public.approval_requests r join assigned d on d.department=r.department
    where r.status='pending'
  ), payload as (
    select jsonb_build_object(
      'pending_count',(select count(*) from pending),
      'items',coalesce((select jsonb_agg(to_jsonb(recent) order by recent.submitted_at desc)
        from (select request_type,department,submitted_at,status from pending order by submitted_at desc limit 5) recent),'[]'::jsonb)
    ) as value
  )
  select case when exists(select 1 from authorized) then payload.value
    else jsonb_build_object('pending_count',null,'items','[]'::jsonb) end from payload;
$$;
revoke all on function public.hod_department_approval_summary() from public,anon;
grant execute on function public.hod_department_approval_summary() to authenticated;

-- Reuse the published-result profile RPC for HOD Overview only. It still reads
-- published monthly results and never exposes nominations or independent reviews.
create or replace function public.period_recognition_winner_profiles(p_award_type text,p_period_start date)
returns table(user_id uuid,display_name text,avatar_path text,departments text[])
language sql stable security definer set search_path = '' as $$
  select m.user_id,
    left(coalesce(nullif(btrim(cp.display_name),''),nullif(btrim(u.raw_user_meta_data->>'full_name),''),
      nullif(btrim(u.raw_user_meta_data->>'name'),''),split_part(u.email,'@',1)),120),
    case when cp.avatar_url ~ '^/account/profile/photo/[0-9a-f-]{36}$' then cp.avatar_url else null end,
    coalesce(array_agg(distinct a.department order by a.department) filter (where a.department is not null),array[]::text[])
  from public.period_recognition_results r
  join public.period_recognition_nominations n on n.id=r.nomination_id and n.award_type=r.award_type and n.period_start=r.period_start
  cross join lateral unnest(n.contributor_ids) c(user_id)
  join public.staff_memberships m on m.user_id=c.user_id and m.status='active' and m.role='staff'
  join auth.users u on u.id=m.user_id and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
  left join public.connect_profiles cp on cp.user_id=m.user_id
  left join public.staff_department_assignments a on a.user_id=m.user_id
  where (eba_private.hub_is_active() or eba_private.hod_dashboard_member(auth.uid()))
    and p_award_type in ('employee_month','teamwork_month','most_improved_month')
    and r.award_type=p_award_type and r.period_start=p_period_start and r.outcome='winner' and r.published_at is not null
  group by m.user_id,cp.display_name,cp.avatar_url,u.raw_user_meta_data,u.email
  order by display_name,user_id;
$$;
revoke all on function public.period_recognition_winner_profiles(text,date) from public,anon;
grant execute on function public.period_recognition_winner_profiles(text,date) to authenticated;

notify pgrst,'reload schema';
commit;
