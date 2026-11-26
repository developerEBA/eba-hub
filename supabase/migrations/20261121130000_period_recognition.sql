begin;

-- Period-specific evidence awards. Weekly recognition remains on its existing
-- tables and RPCs so published weekly results and review behavior are intact.
create table public.period_recognition_nominations (
  id uuid primary key default gen_random_uuid(),
  award_type text not null check (award_type in ('employee_month','employee_year','teamwork_month','teamwork_year')),
  period_start date not null,
  contributor_ids uuid[] not null check (cardinality(contributor_ids) between 1 and 50),
  what_they_did text not null check (length(btrim(what_they_did)) between 1 and 1500),
  collaboration text not null check (length(btrim(collaboration)) between 1 and 1500),
  who_benefited text not null check (length(btrim(who_benefited)) between 1 and 1500),
  what_changed text not null check (length(btrim(what_changed)) between 1 and 1500),
  evidence_date date not null,
  evidence_url text not null check (evidence_url ~ '^https://[^[:space:]]+$' and length(evidence_url) <= 2048),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  unique (award_type, period_start, id),
  unique (award_type, period_start, contributor_ids),
  check ((award_type like 'teamwork_%' and cardinality(contributor_ids) >= 2)
      or (award_type like 'employee_%' and cardinality(contributor_ids) = 1)),
  check ((award_type like '%_month' and extract(day from period_start) = 1)
      or (award_type like '%_year' and extract(doy from period_start) = 1))
);

create table public.period_recognition_reviews (
  award_type text not null,
  period_start date not null,
  reviewer_role text not null check (reviewer_role in ('ceo','admin')),
  reviewer_id uuid not null references auth.users(id),
  nomination_id uuid,
  impact text not null check (length(btrim(impact)) between 1 and 500),
  contribution text not null check (length(btrim(contribution)) between 1 and 500),
  evidence_strength text not null check (length(btrim(evidence_strength)) between 1 and 500),
  submitted_at timestamptz not null default now(),
  primary key (award_type, period_start, reviewer_role),
  unique (award_type, period_start, reviewer_id),
  foreign key (award_type, period_start, nomination_id)
    references public.period_recognition_nominations(award_type,period_start,id),
  check (award_type in ('employee_month','employee_year','teamwork_month','teamwork_year'))
);

create table public.period_recognition_results (
  award_type text not null,
  period_start date not null,
  outcome text not null check (outcome in ('winner','no_award')),
  nomination_id uuid,
  result_label text not null check (length(btrim(result_label)) between 1 and 600),
  public_reason text not null check (length(btrim(public_reason)) between 1 and 240),
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  primary key (award_type, period_start),
  foreign key (award_type, period_start, nomination_id)
    references public.period_recognition_nominations(award_type,period_start,id),
  check ((outcome = 'winner' and nomination_id is not null) or (outcome = 'no_award' and nomination_id is null))
);

alter table public.period_recognition_nominations enable row level security;
alter table public.period_recognition_reviews enable row level security;
alter table public.period_recognition_results enable row level security;
revoke all on public.period_recognition_nominations, public.period_recognition_reviews, public.period_recognition_results from public, anon, authenticated;
grant select on public.period_recognition_nominations, public.period_recognition_reviews, public.period_recognition_results to authenticated;

create function eba_private.period_recognition_both_reviews(p_type text, p_start date)
returns boolean language sql stable security definer set search_path = ''
as $$ select eba_private.hub_is_active() and count(*) = 2
  from public.period_recognition_reviews where award_type = p_type and period_start = p_start; $$;
revoke all on function eba_private.period_recognition_both_reviews(text,date) from public, anon, authenticated;
grant execute on function eba_private.period_recognition_both_reviews(text,date) to authenticated;

create policy "Active executives read period recognition nominations"
  on public.period_recognition_nominations for select to authenticated
  using ((select eba_private.hub_is_active()));
create policy "Reviewers see own period review until both submit"
  on public.period_recognition_reviews for select to authenticated
  using ((select eba_private.hub_is_active()) and
    (reviewer_id = (select auth.uid()) or eba_private.period_recognition_both_reviews(award_type,period_start)));
create policy "Active executives read published period recognition"
  on public.period_recognition_results for select to authenticated
  using ((select eba_private.hub_is_active()));

create function public.period_recognition_candidates()
returns table(user_id uuid, display_name text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'),''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'),''),split_part(u.email,'@',1)),120)
  from public.staff_memberships m join auth.users u on u.id=m.user_id
  where eba_private.hub_is_active() and m.role='staff' and m.status='active'
    and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
  order by 2,1;
$$;

create function public.period_recognition_nominate(
  p_award_type text,p_period_start date,p_evidence_date date,p_contributor_ids uuid[],p_what text,p_collaboration text,
  p_beneficiaries text,p_results text,p_evidence_url text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); normalized_ids uuid[]; expected_start date; period_end date; new_id uuid;
begin
  if not eba_private.hub_is_active() then raise insufficient_privilege; end if;
  if p_award_type not in ('employee_month','employee_year','teamwork_month','teamwork_year') or p_period_start is null then return null; end if;
  if p_award_type like '%_month' then
    expected_start := date_trunc('month', (now() at time zone 'Africa/Lagos'))::date;
    if extract(day from p_period_start)<>1 or p_period_start>=expected_start then return null; end if;
    period_end := (p_period_start + interval '1 month')::date;
  else
    expected_start := date_trunc('year', (now() at time zone 'Africa/Lagos'))::date;
    if extract(doy from p_period_start)<>1 or p_period_start>=expected_start then return null; end if;
    period_end := (p_period_start + interval '1 year')::date;
  end if;
  if p_evidence_date is null or p_evidence_date<p_period_start or p_evidence_date>=period_end
    or p_contributor_ids is null or cardinality(p_contributor_ids) not between 1 and 50
    or cardinality(p_contributor_ids)<>(select count(distinct user_id) from unnest(p_contributor_ids) as ids(user_id))
    or (p_award_type like 'teamwork_%' and cardinality(p_contributor_ids)<2)
    or (p_award_type like 'employee_%' and cardinality(p_contributor_ids)<>1)
    or coalesce(length(btrim(p_what)),0) not between 1 and 1500 or coalesce(length(btrim(p_collaboration)),0) not between 1 and 1500
    or coalesce(length(btrim(p_beneficiaries)),0) not between 1 and 1500 or coalesce(length(btrim(p_results)),0) not between 1 and 1500
    or p_evidence_url is null or p_evidence_url !~ '^https://[^[:space:]]+$' or length(p_evidence_url)>2048 then return null; end if;
  select array_agg(user_id order by user_id) into normalized_ids from unnest(p_contributor_ids) as ids(user_id);
  if (select count(*) from public.staff_memberships m join auth.users u on u.id=m.user_id
    where m.user_id=any(normalized_ids) and m.role='staff' and m.status='active'
      and lower(u.email) ~ '^[^@]+@enibrand[.]com$')<>cardinality(normalized_ids) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_award_type||p_period_start::text,0));
  if not eba_private.recognition_admin() then raise insufficient_privilege using message='Only an active Admin can publish recognition'; end if;
  if exists(select 1 from public.period_recognition_results where award_type=p_award_type and period_start=p_period_start) then return null; end if;
  insert into public.period_recognition_nominations(award_type,period_start,contributor_ids,what_they_did,collaboration,who_benefited,what_changed,evidence_date,evidence_url,submitted_by)
  values(p_award_type,p_period_start,normalized_ids,btrim(p_what),btrim(p_collaboration),btrim(p_beneficiaries),btrim(p_results),p_evidence_date,p_evidence_url,caller)
  on conflict (award_type,period_start,contributor_ids) do nothing returning id into new_id;
  return new_id;
end; $$;

create function public.period_recognition_review(
  p_award_type text,p_period_start date,p_nomination_id uuid,p_impact text,p_contribution text,p_evidence_strength text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); caller_role text; period_limit date;
begin
  if not eba_private.hub_is_active() then raise insufficient_privilege; end if;
  if p_award_type not in ('employee_month','employee_year','teamwork_month','teamwork_year') or p_period_start is null then return false; end if;
  select m.role into caller_role from public.staff_memberships m where m.user_id=caller and m.status='active' and m.role in ('ceo','admin');
  if caller_role is null then raise insufficient_privilege; end if;
  if p_award_type like '%_month' then
    period_limit:=date_trunc('month',(now() at time zone 'Africa/Lagos'))::date;
    if extract(day from p_period_start)<>1 or p_period_start>=period_limit then return false; end if;
  else
    period_limit:=date_trunc('year',(now() at time zone 'Africa/Lagos'))::date;
    if extract(doy from p_period_start)<>1 or p_period_start>=period_limit then return false; end if;
  end if;
  if length(btrim(p_impact)) not between 1 and 500 or length(btrim(p_contribution)) not between 1 and 500
    or length(btrim(p_evidence_strength)) not between 1 and 500 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_award_type||p_period_start::text,0));
  if exists(select 1 from public.period_recognition_results where award_type=p_award_type and period_start=p_period_start) then return false; end if;
  if p_nomination_id is not null and not exists(select 1 from public.period_recognition_nominations
    where id=p_nomination_id and award_type=p_award_type and period_start=p_period_start) then return false; end if;
  if p_nomination_id is not null and exists(select 1 from public.period_recognition_nominations n
    where n.id=p_nomination_id and n.award_type=p_award_type and n.period_start=p_period_start
      and (select count(*) from public.staff_memberships m join auth.users u on u.id=m.user_id
        where m.user_id=any(n.contributor_ids) and m.role='staff' and m.status='active'
          and lower(u.email) ~ '^[^@]+@enibrand[.]com$')<>cardinality(n.contributor_ids)) then return false; end if;
  if exists(select 1 from public.period_recognition_reviews where award_type=p_award_type and period_start=p_period_start and reviewer_id=caller and reviewer_role<>caller_role) then return false; end if;
  insert into public.period_recognition_reviews as existing(award_type,period_start,reviewer_role,reviewer_id,nomination_id,impact,contribution,evidence_strength)
  values(p_award_type,p_period_start,caller_role,caller,p_nomination_id,btrim(p_impact),btrim(p_contribution),btrim(p_evidence_strength))
  on conflict(award_type,period_start,reviewer_role) do update set nomination_id=excluded.nomination_id,impact=excluded.impact,
    contribution=excluded.contribution,evidence_strength=excluded.evidence_strength,submitted_at=statement_timestamp()
  where existing.reviewer_id=caller and eba_private.period_recognition_both_reviews(p_award_type,p_period_start);
  return found;
end; $$;

create function public.period_recognition_publish(p_award_type text,p_period_start date,p_nomination_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare label text; result_kind text; period_limit date;
begin
  if not eba_private.recognition_admin() then raise insufficient_privilege using message='Only an active Admin can publish recognition'; end if;
  if p_award_type not in ('employee_month','employee_year','teamwork_month','teamwork_year') or p_period_start is null or coalesce(length(btrim(p_reason)),0) not between 1 and 240 then return false; end if;
  if p_award_type like '%_month' then period_limit:=date_trunc('month',(now() at time zone 'Africa/Lagos'))::date;
    if extract(day from p_period_start)<>1 or p_period_start>=period_limit then return false; end if;
  else period_limit:=date_trunc('year',(now() at time zone 'Africa/Lagos'))::date;
    if extract(doy from p_period_start)<>1 or p_period_start>=period_limit then return false; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_award_type||p_period_start::text,0));
  if (select count(*) from public.period_recognition_reviews where award_type=p_award_type and period_start=p_period_start)<>2
    or exists(select 1 from public.period_recognition_reviews a join public.period_recognition_reviews b
      on a.award_type=b.award_type and a.period_start=b.period_start and a.reviewer_role='ceo' and b.reviewer_role='admin'
      where a.award_type=p_award_type and a.period_start=p_period_start and a.nomination_id is distinct from b.nomination_id) then return false; end if;
  if (select nomination_id from public.period_recognition_reviews where award_type=p_award_type and period_start=p_period_start limit 1) is distinct from p_nomination_id then return false; end if;
  if p_nomination_id is null then label:='No award'; result_kind:='no_award';
  else
    if not exists(select 1 from public.period_recognition_nominations n where n.id=p_nomination_id and n.award_type=p_award_type and n.period_start=p_period_start
      and (select count(*) from public.staff_memberships m join auth.users u on u.id=m.user_id
        where m.user_id=any(n.contributor_ids) and m.role='staff' and m.status='active'
          and lower(u.email) ~ '^[^@]+@enibrand[.]com$')=cardinality(n.contributor_ids)) then return false; end if;
    select string_agg(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),split_part(u.email,'@',1)),', ' order by m.user_id)
      into label from public.period_recognition_nominations n cross join lateral unnest(n.contributor_ids) c(user_id)
      join public.staff_memberships m on m.user_id=c.user_id and m.status='active' and m.role='staff'
      join auth.users u on u.id=m.user_id where n.id=p_nomination_id and n.award_type=p_award_type and n.period_start=p_period_start
        and lower(u.email) ~ '^[^@]+@enibrand[.]com$';
    if label is null then return false; end if;
    result_kind:='winner';
  end if;
  insert into public.period_recognition_results(award_type,period_start,outcome,nomination_id,result_label,public_reason,published_by)
  values(p_award_type,p_period_start,result_kind,p_nomination_id,label,btrim(p_reason),auth.uid()) on conflict(award_type,period_start) do nothing;
  return found;
end; $$;

revoke all on function public.period_recognition_candidates(), public.period_recognition_nominate(text,date,date,uuid[],text,text,text,text,text),
  public.period_recognition_review(text,date,uuid,text,text,text), public.period_recognition_publish(text,date,uuid,text)
  from public,anon,authenticated;
grant execute on function public.period_recognition_candidates(), public.period_recognition_nominate(text,date,date,uuid[],text,text,text,text,text),
  public.period_recognition_review(text,date,uuid,text,text,text), public.period_recognition_publish(text,date,uuid,text) to authenticated;
commit;
