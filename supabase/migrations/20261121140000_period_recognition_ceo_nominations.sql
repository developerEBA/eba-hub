begin;

-- Fix the post-lock nomination authorization check only. The original period
-- migration may already be applied; this forward migration is safe after it.
create or replace function public.period_recognition_nominate(
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
  -- Recheck the active CEO/Admin gate after locking; publication alone is Admin-only.
  if not eba_private.hub_is_active() then raise insufficient_privilege; end if;
  if exists(select 1 from public.period_recognition_results where award_type=p_award_type and period_start=p_period_start) then return null; end if;
  insert into public.period_recognition_nominations(award_type,period_start,contributor_ids,what_they_did,collaboration,who_benefited,what_changed,evidence_date,evidence_url,submitted_by)
  values(p_award_type,p_period_start,normalized_ids,btrim(p_what),btrim(p_collaboration),btrim(p_beneficiaries),btrim(p_results),p_evidence_date,p_evidence_url,caller)
  on conflict (award_type,period_start,contributor_ids) do nothing returning id into new_id;
  return new_id;
end; $$;

commit;
