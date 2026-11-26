begin;

-- Weekly results now record an explicit no-award outcome. Existing published
-- rows are preserved and treated as winner outcomes.
alter table public.weekly_recognition
  add column outcome text not null default 'winner'
  check (outcome in ('winner','no_award'));

-- Optional audit metadata for legacy nominations stays NULL; new nominations
-- are written through the RPC below with real submitter and evidence date.
alter table public.weekly_recognition_nominations
  add column nominated_by uuid references auth.users(id),
  add column evidence_date date;

create or replace function eba_private.weekly_recognition_candidates()
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), split_part(u.email, '@', 1)), 120)
  from public.staff_memberships m join auth.users u on u.id = m.user_id
  where eba_private.hub_is_active() and m.role = 'staff' and m.status = 'active'
    and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
  order by 2, 1;
$$;

create or replace function public.submit_weekly_recognition_nomination(
  p_week_start date, p_nominee_id uuid, p_evidence_date date,
  p_what text, p_beneficiaries text, p_results text, p_evidence_url text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); clean_what text := btrim(p_what); clean_beneficiaries text := btrim(p_beneficiaries);
  clean_results text := btrim(p_results); nominee text;
begin
  if not eba_private.hub_is_active() then raise insufficient_privilege; end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1
    or p_week_start > (now() at time zone 'Africa/Lagos')::date
    or p_evidence_date is null or p_evidence_date < p_week_start or p_evidence_date >= p_week_start + 7
    or p_evidence_date > (now() at time zone 'Africa/Lagos')::date
    or clean_what is null or length(clean_what) not between 1 and 1500
    or clean_beneficiaries is null or length(clean_beneficiaries) not between 1 and 1500
    or clean_results is null or length(clean_results) not between 1 and 1500
    or p_evidence_url is null or p_evidence_url !~ '^https://[^[:space:]]+$' or length(p_evidence_url)>2048
  then return false; end if;
  nominee := eba_private.recognition_employee_name(p_nominee_id);
  if nominee is null then return false; end if;
  perform pg_advisory_xact_lock(1760, p_week_start - date '2000-01-01');
  if not eba_private.hub_is_active() then raise insufficient_privilege; end if;
  if exists(select 1 from public.weekly_recognition where week_start=p_week_start) then return false; end if;
  insert into public.weekly_recognition_nominations
    (week_start,nominee_id,nominee_name,what_they_did,who_benefited,what_changed,evidence_url,nominated_by,evidence_date)
  values (p_week_start,p_nominee_id,nominee,clean_what,clean_beneficiaries,clean_results,p_evidence_url,caller,p_evidence_date)
  on conflict (week_start,nominee_id) do update set
    what_they_did=excluded.what_they_did,who_benefited=excluded.who_benefited,what_changed=excluded.what_changed,
    evidence_url=excluded.evidence_url,nominated_by=excluded.nominated_by,evidence_date=excluded.evidence_date
  where public.weekly_recognition_nominations.evidence_date is null
    and not exists(select 1 from public.weekly_recognition_reviews r where r.week_start=excluded.week_start);
  return found;
end; $$;

revoke all on function public.submit_weekly_recognition_nomination(date,uuid,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_weekly_recognition_nomination(date,uuid,date,text,text,text,text) to authenticated;

create or replace function eba_private.publish_weekly_recognition(p_week_start date, p_winner_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare clean_reason text := btrim(p_reason,E' \t\r\n'); winner text; caller uuid := auth.uid(); caller_role text;
begin
  if not eba_private.hub_is_active() or not exists(select 1 from public.staff_memberships m where m.user_id=caller and m.role='ceo' and m.status='active') then
    raise insufficient_privilege using message='Only an active CEO can publish recognition';
  end if;
  if p_week_start is null or extract(isodow from p_week_start)<>1 or p_week_start>(now() at time zone 'Africa/Lagos')::date
    or clean_reason is null or length(clean_reason) not between 1 and 240 then return false; end if;
  perform pg_advisory_xact_lock(1760,p_week_start-date '2000-01-01');
  if not eba_private.hub_is_active() or not exists(select 1 from public.staff_memberships m where m.user_id=caller and m.role='ceo' and m.status='active') then raise insufficient_privilege; end if;
  if (select count(*) from public.weekly_recognition_reviews where week_start=p_week_start)<>2
    or exists(select 1 from public.weekly_recognition_reviews a join public.weekly_recognition_reviews b on a.week_start=b.week_start
      where a.week_start=p_week_start and a.reviewer_role='ceo' and b.reviewer_role='admin' and a.nominee_id is distinct from b.nominee_id)
    or (select nominee_id from public.weekly_recognition_reviews where week_start=p_week_start limit 1) is distinct from p_winner_id then return false; end if;
  if p_winner_id is null then
    insert into public.weekly_recognition(week_start,winner_id,winner_name,reason,published_by,outcome)
    values(p_week_start,null,'No award',clean_reason,caller,'no_award') on conflict(week_start) do nothing;
    return found;
  end if;
  if not exists(select 1 from public.weekly_recognition_nominations n where n.week_start=p_week_start and n.nominee_id=p_winner_id
    and eba_private.recognition_employee_name(n.nominee_id) is not null
    and n.evidence_date is not null and n.evidence_date>=p_week_start and n.evidence_date<p_week_start+7) then return false; end if;
  perform 1 from public.staff_memberships m join auth.users u on u.id=m.user_id where m.user_id=p_winner_id and m.role='staff' and m.status='active'
    and lower(u.email) ~ '^[^@]+@enibrand[.]com$' for share of m,u;
  if not found then return false; end if;
  winner:=eba_private.recognition_employee_name(p_winner_id); if winner is null then return false; end if;
  insert into public.weekly_recognition(week_start,winner_id,winner_name,reason,published_by,outcome)
  values(p_week_start,p_winner_id,winner,clean_reason,caller,'winner') on conflict(week_start) do nothing;
  return found;
end; $$;

create or replace function public.period_recognition_publish(p_award_type text,p_period_start date,p_nomination_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare label text; result_kind text; period_limit date; caller uuid:=auth.uid();
begin
  if not eba_private.hub_is_active() or not exists(select 1 from public.staff_memberships m where m.user_id=caller and m.role='ceo' and m.status='active') then
    raise insufficient_privilege using message='Only an active CEO can publish recognition'; end if;
  if p_award_type not in ('employee_month','employee_year','teamwork_month','teamwork_year') or p_period_start is null or coalesce(length(btrim(p_reason)),0) not between 1 and 240 then return false; end if;
  if p_award_type like '%_month' then period_limit:=date_trunc('month',(now() at time zone 'Africa/Lagos'))::date;
    if extract(day from p_period_start)<>1 or p_period_start>=period_limit then return false; end if;
  else period_limit:=date_trunc('year',(now() at time zone 'Africa/Lagos'))::date;
    if extract(doy from p_period_start)<>1 or p_period_start>=period_limit then return false; end if; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_award_type||p_period_start::text,0));
  if not eba_private.hub_is_active() or not exists(select 1 from public.staff_memberships m where m.user_id=caller and m.role='ceo' and m.status='active') then raise insufficient_privilege; end if;
  if (select count(*) from public.period_recognition_reviews where award_type=p_award_type and period_start=p_period_start)<>2
    or exists(select 1 from public.period_recognition_reviews a join public.period_recognition_reviews b on a.award_type=b.award_type and a.period_start=b.period_start
      where a.award_type=p_award_type and a.period_start=p_period_start and a.reviewer_role='ceo' and b.reviewer_role='admin' and a.nomination_id is distinct from b.nomination_id)
    or (select nomination_id from public.period_recognition_reviews where award_type=p_award_type and period_start=p_period_start limit 1) is distinct from p_nomination_id then return false; end if;
  if p_nomination_id is null then label:='No award'; result_kind:='no_award';
  else
    if not exists(select 1 from public.period_recognition_nominations n where n.id=p_nomination_id and n.award_type=p_award_type and n.period_start=p_period_start
      and n.evidence_date>=p_period_start and ((p_award_type like '%_month' and n.evidence_date<(p_period_start+interval '1 month')::date)
        or (p_award_type like '%_year' and n.evidence_date<(p_period_start+interval '1 year')::date))
      and (select count(*) from public.staff_memberships m join auth.users u on u.id=m.user_id where m.user_id=any(n.contributor_ids) and m.role='staff' and m.status='active'
        and lower(u.email) ~ '^[^@]+@enibrand[.]com$')=cardinality(n.contributor_ids)) then return false; end if;
    select string_agg(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),split_part(u.email,'@',1)),', ' order by m.user_id)
      into label from public.period_recognition_nominations n cross join lateral unnest(n.contributor_ids) c(user_id)
      join public.staff_memberships m on m.user_id=c.user_id and m.status='active' and m.role='staff' join auth.users u on u.id=m.user_id
      where n.id=p_nomination_id and n.award_type=p_award_type and n.period_start=p_period_start and lower(u.email) ~ '^[^@]+@enibrand[.]com$';
    if label is null then return false; end if; result_kind:='winner';
  end if;
  insert into public.period_recognition_results(award_type,period_start,outcome,nomination_id,result_label,public_reason,published_by)
  values(p_award_type,p_period_start,result_kind,p_nomination_id,label,btrim(p_reason),caller) on conflict(award_type,period_start) do nothing;
  return found;
end; $$;

commit;
