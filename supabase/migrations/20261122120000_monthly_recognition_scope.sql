begin;

-- Retire legacy weekly/yearly categories without deleting their records.
-- Existing period tables retain their original category check constraints so
-- old rows remain readable. Active write RPCs below accept only these types.
alter table public.period_recognition_nominations
  add column before_date date,
  add column after_date date,
  add column before_evidence text,
  add column after_evidence text;

alter table public.period_recognition_nominations
  add constraint period_recognition_improvement_evidence_check check (
    (award_type <> 'most_improved_month' or
      (cardinality(contributor_ids)=1 and before_date is not null and after_date is not null
       and before_date < after_date and after_date >= period_start
       and after_date < (period_start + interval '1 month')::date
       and length(btrim(before_evidence)) between 1 and 1200
       and length(btrim(after_evidence)) between 1 and 1200))
  );

create or replace function public.period_recognition_nominate(
  p_award_type text,p_period_start date,p_evidence_date date,p_contributor_ids uuid[],p_what text,p_collaboration text,
  p_beneficiaries text,p_results text,p_evidence_url text,
  p_before_date date default null,p_after_date date default null,p_before_evidence text default null,p_after_evidence text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); normalized_ids uuid[]; expected_start date; period_end date; new_id uuid;
begin
  if not eba_private.hub_is_active() then raise insufficient_privilege; end if;
  if p_award_type not in ('employee_month','teamwork_month','most_improved_month') or p_period_start is null then return null; end if;
  expected_start := date_trunc('month',(now() at time zone 'Africa/Lagos'))::date;
  if extract(day from p_period_start)<>1 or p_period_start>=expected_start then return null; end if;
  period_end := (p_period_start + interval '1 month')::date;
  if p_evidence_date is null or p_evidence_date<p_period_start or p_evidence_date>=period_end
    or p_contributor_ids is null or cardinality(p_contributor_ids) not between 1 and 50
    or cardinality(p_contributor_ids)<>(select count(distinct user_id) from unnest(p_contributor_ids) as ids(user_id))
    or (p_award_type='teamwork_month' and cardinality(p_contributor_ids)<2)
    or (p_award_type in ('employee_month','most_improved_month') and cardinality(p_contributor_ids)<>1)
    or coalesce(length(btrim(p_what)),0) not between 1 and 1500 or coalesce(length(btrim(p_collaboration)),0) not between 1 and 1500
    or coalesce(length(btrim(p_beneficiaries)),0) not between 1 and 1500 or coalesce(length(btrim(p_results)),0) not between 1 and 1500
    or p_evidence_url is null or p_evidence_url !~ '^https://[^[:space:]]+$' or length(p_evidence_url)>2048 then return null; end if;
  if p_award_type='most_improved_month' and (p_before_date is null or p_after_date is null or p_before_date>=p_after_date
    or p_after_date<p_period_start or p_after_date>=period_end
    or coalesce(length(btrim(p_before_evidence)),0) not between 1 and 1200
    or coalesce(length(btrim(p_after_evidence)),0) not between 1 and 1200) then return null; end if;
  select array_agg(user_id order by user_id) into normalized_ids from unnest(p_contributor_ids) as ids(user_id);
  if (select count(*) from public.staff_memberships m join auth.users u on u.id=m.user_id
    where m.user_id=any(normalized_ids) and m.role='staff' and m.status='active'
      and lower(u.email) ~ '^[^@]+@enibrand[.]com$')<>cardinality(normalized_ids) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_award_type||p_period_start::text,0));
  if not eba_private.hub_is_active() then raise insufficient_privilege; end if;
  if exists(select 1 from public.period_recognition_results where award_type=p_award_type and period_start=p_period_start) then return null; end if;
  insert into public.period_recognition_nominations(award_type,period_start,contributor_ids,what_they_did,collaboration,who_benefited,what_changed,evidence_date,evidence_url,submitted_by,before_date,after_date,before_evidence,after_evidence)
  values(p_award_type,p_period_start,normalized_ids,btrim(p_what),btrim(p_collaboration),btrim(p_beneficiaries),btrim(p_results),p_evidence_date,p_evidence_url,caller,p_before_date,p_after_date,nullif(btrim(p_before_evidence),''),nullif(btrim(p_after_evidence),''))
  on conflict (award_type,period_start,contributor_ids) do nothing returning id into new_id;
  return new_id;
end; $$;

create or replace function public.period_recognition_review(
  p_award_type text,p_period_start date,p_nomination_id uuid,p_impact text,p_contribution text,p_evidence_strength text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); caller_role text; period_limit date;
begin
  if not eba_private.hub_is_active() then raise insufficient_privilege; end if;
  if p_award_type not in ('employee_month','teamwork_month','most_improved_month') or p_period_start is null then return false; end if;
  select m.role into caller_role from public.staff_memberships m where m.user_id=caller and m.status='active' and m.role in ('ceo','admin');
  if caller_role is null then raise insufficient_privilege; end if;
  period_limit:=date_trunc('month',(now() at time zone 'Africa/Lagos'))::date;
  if extract(day from p_period_start)<>1 or p_period_start>=period_limit then return false; end if;
  if length(btrim(p_impact)) not between 1 and 500 or length(btrim(p_contribution)) not between 1 and 500 or length(btrim(p_evidence_strength)) not between 1 and 500 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_award_type||p_period_start::text,0));
  if exists(select 1 from public.period_recognition_results where award_type=p_award_type and period_start=p_period_start) then return false; end if;
  if p_nomination_id is not null and not exists(select 1 from public.period_recognition_nominations n where n.id=p_nomination_id and n.award_type=p_award_type and n.period_start=p_period_start
    and (select count(*) from public.staff_memberships m join auth.users u on u.id=m.user_id where m.user_id=any(n.contributor_ids) and m.role='staff' and m.status='active' and lower(u.email) ~ '^[^@]+@enibrand[.]com$')=cardinality(n.contributor_ids)) then return false; end if;
  if exists(select 1 from public.period_recognition_reviews where award_type=p_award_type and period_start=p_period_start and reviewer_id=caller and reviewer_role<>caller_role) then return false; end if;
  insert into public.period_recognition_reviews as existing(award_type,period_start,reviewer_role,reviewer_id,nomination_id,impact,contribution,evidence_strength)
  values(p_award_type,p_period_start,caller_role,caller,p_nomination_id,btrim(p_impact),btrim(p_contribution),btrim(p_evidence_strength))
  on conflict(award_type,period_start,reviewer_role) do update set nomination_id=excluded.nomination_id,impact=excluded.impact,contribution=excluded.contribution,evidence_strength=excluded.evidence_strength,submitted_at=statement_timestamp()
  where existing.reviewer_id=caller and eba_private.period_recognition_both_reviews(p_award_type,p_period_start);
  return found;
end; $$;

create or replace function public.period_recognition_publish(p_award_type text,p_period_start date,p_nomination_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare label text; result_kind text; period_limit date; caller uuid:=auth.uid();
begin
  if not eba_private.hub_is_active() or not exists(select 1 from public.staff_memberships m where m.user_id=caller and m.role='ceo' and m.status='active') then raise insufficient_privilege using message='Only an active CEO can publish recognition'; end if;
  if p_award_type not in ('employee_month','teamwork_month','most_improved_month') or p_period_start is null or coalesce(length(btrim(p_reason)),0) not between 1 and 240 then return false; end if;
  period_limit:=date_trunc('month',(now() at time zone 'Africa/Lagos'))::date;
  if extract(day from p_period_start)<>1 or p_period_start>=period_limit then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_award_type||p_period_start::text,0));
  if not eba_private.hub_is_active() or not exists(select 1 from public.staff_memberships m where m.user_id=caller and m.role='ceo' and m.status='active') then raise insufficient_privilege; end if;
  if (select count(*) from public.period_recognition_reviews where award_type=p_award_type and period_start=p_period_start)<>2
    or exists(select 1 from public.period_recognition_reviews a join public.period_recognition_reviews b on a.award_type=b.award_type and a.period_start=b.period_start where a.award_type=p_award_type and a.period_start=p_period_start and a.reviewer_role='ceo' and b.reviewer_role='admin' and a.nomination_id is distinct from b.nomination_id)
    or (select nomination_id from public.period_recognition_reviews where award_type=p_award_type and period_start=p_period_start limit 1) is distinct from p_nomination_id then return false; end if;
  if p_nomination_id is null then label:='No award'; result_kind:='no_award';
  else
    if not exists(select 1 from public.period_recognition_nominations n where n.id=p_nomination_id and n.award_type=p_award_type and n.period_start=p_period_start and n.evidence_date>=p_period_start and n.evidence_date<(p_period_start+interval '1 month')::date
      and (select count(*) from public.staff_memberships m join auth.users u on u.id=m.user_id where m.user_id=any(n.contributor_ids) and m.role='staff' and m.status='active' and lower(u.email) ~ '^[^@]+@enibrand[.]com$')=cardinality(n.contributor_ids)) then return false; end if;
    select string_agg(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),split_part(u.email,'@',1)),', ' order by m.user_id) into label
    from public.period_recognition_nominations n cross join lateral unnest(n.contributor_ids) c(user_id) join public.staff_memberships m on m.user_id=c.user_id and m.status='active' and m.role='staff' join auth.users u on u.id=m.user_id where n.id=p_nomination_id and n.award_type=p_award_type and n.period_start=p_period_start and lower(u.email) ~ '^[^@]+@enibrand[.]com$';
    if label is null then return false; end if; result_kind:='winner';
  end if;
  insert into public.period_recognition_results(award_type,period_start,outcome,nomination_id,result_label,public_reason,published_by) values(p_award_type,p_period_start,result_kind,p_nomination_id,label,btrim(p_reason),caller) on conflict(award_type,period_start) do nothing;
  return found;
end; $$;

revoke all on function public.period_recognition_nominate(text,date,date,uuid[],text,text,text,text,text,date,date,text,text) from public,anon,authenticated;
grant execute on function public.period_recognition_nominate(text,date,date,uuid[],text,text,text,text,text,date,date,text,text) to authenticated;

commit;
