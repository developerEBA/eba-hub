begin;

-- Retain historical award types while opening the monthly Most Improved type
-- to the existing monthly nomination and independent-review workflow.
alter table public.period_recognition_nominations drop constraint if exists period_recognition_nominations_award_type_check;
alter table public.period_recognition_nominations add constraint period_recognition_nominations_award_type_check
  check (award_type in ('employee_month','employee_year','teamwork_month','teamwork_year','most_improved_month'));
do $drop_contributor_check$ declare c record; begin
  for c in select conname from pg_catalog.pg_constraint
    where conrelid='public.period_recognition_nominations'::regclass and contype='c'
      and pg_catalog.pg_get_constraintdef(oid) like '%cardinality(contributor_ids)%' loop
    execute format('alter table public.period_recognition_nominations drop constraint %I',c.conname);
  end loop;
end $drop_contributor_check$;
alter table public.period_recognition_nominations add constraint period_recognition_contributor_count_check
  check ((award_type like 'teamwork_%' and cardinality(contributor_ids) between 2 and 50)
      or ((award_type like 'employee_%' or award_type='most_improved_month') and cardinality(contributor_ids)=1));
alter table public.period_recognition_reviews drop constraint if exists period_recognition_reviews_award_type_check;
alter table public.period_recognition_reviews add constraint period_recognition_reviews_award_type_check
  check (award_type in ('employee_month','employee_year','teamwork_month','teamwork_year','most_improved_month'));

-- Only active CEO/Admin dashboard sessions may resolve profile details for a
-- published monthly winner. Reviews and unpublished nominations are never read.
create or replace function public.period_recognition_winner_profiles(p_award_type text,p_period_start date)
returns table(user_id uuid,display_name text,avatar_path text,departments text[])
language sql stable security definer set search_path = '' as $$
  select m.user_id,
    left(coalesce(nullif(btrim(cp.display_name),''),nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
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
  where eba_private.hub_is_active()
    and p_award_type in ('employee_month','teamwork_month','most_improved_month')
    and r.award_type=p_award_type and r.period_start=p_period_start and r.outcome='winner'
  group by m.user_id,cp.display_name,cp.avatar_url,u.raw_user_meta_data,u.email
  order by display_name,user_id;
$$;
revoke all on function public.period_recognition_winner_profiles(text,date) from public,anon,authenticated;
grant execute on function public.period_recognition_winner_profiles(text,date) to authenticated;

commit;
