begin;

create table public.weekly_recognition_nominations (
  week_start date not null check (extract(isodow from week_start) = 1),
  nominee_id uuid not null references auth.users(id),
  nominee_name text not null,
  what_they_did text not null check (length(btrim(what_they_did)) between 1 and 1500),
  who_benefited text not null check (length(btrim(who_benefited)) between 1 and 1500),
  what_changed text not null check (length(btrim(what_changed)) between 1 and 1500),
  evidence_url text check (evidence_url ~ '^https://[^[:space:]]+$' and length(evidence_url) <= 2048),
  primary key (week_start, nominee_id)
);

create table public.weekly_recognition_reviews (
  week_start date not null check (extract(isodow from week_start) = 1),
  reviewer_role text not null check (reviewer_role in ('ceo', 'admin')),
  reviewer_id uuid not null references auth.users(id),
  nominee_id uuid,
  impact text not null check (length(btrim(impact)) between 1 and 500),
  contribution text not null check (length(btrim(contribution)) between 1 and 500),
  evidence_strength text not null check (length(btrim(evidence_strength)) between 1 and 500),
  submitted_at timestamptz not null default now(),
  primary key (week_start, reviewer_role),
  unique (week_start, reviewer_id),
  foreign key (week_start, nominee_id) references public.weekly_recognition_nominations (week_start, nominee_id)
);

alter table public.weekly_recognition_nominations enable row level security;
alter table public.weekly_recognition_reviews enable row level security;
revoke all on public.weekly_recognition_nominations, public.weekly_recognition_reviews from public, anon, authenticated;
grant select on public.weekly_recognition_nominations, public.weekly_recognition_reviews to authenticated;

create function eba_private.recognition_both_reviews(p_week date)
returns boolean language sql stable security definer set search_path = ''
as $$
  select eba_private.hub_is_active() and count(*) = 2
  from public.weekly_recognition_reviews where week_start = p_week;
$$;
revoke all on function eba_private.recognition_both_reviews(date) from public, anon, authenticated;
grant execute on function eba_private.recognition_both_reviews(date) to authenticated;

create policy "Active executives read recognition evidence"
  on public.weekly_recognition_nominations for select to authenticated
  using ((select eba_private.hub_is_active()));

create policy "Reviewers see their own review until both submit"
  on public.weekly_recognition_reviews for select to authenticated
  using (
    (select eba_private.hub_is_active())
    and (reviewer_id = (select auth.uid()) or eba_private.recognition_both_reviews(week_start))
  );

create function eba_private.recognition_employee_name(person uuid)
returns text language sql stable set search_path = ''
as $$
  select left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), split_part(u.email, '@', 1)), 120)
  from public.staff_memberships m join auth.users u on u.id = m.user_id
  where m.user_id = person and m.role = 'staff' and m.status = 'active'
    and lower(u.email) ~ '^[^@]+@enibrand[.]com$';
$$;

create function eba_private.validate_recognition_nominee()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.nominee_name := eba_private.recognition_employee_name(new.nominee_id);
  if new.nominee_name is null then
    raise check_violation using message = 'Recognition nominee must be an eligible active employee';
  end if;
  return new;
end;
$$;

create trigger validate_recognition_nominee before insert or update of nominee_id, nominee_name
  on public.weekly_recognition_nominations for each row
  execute function eba_private.validate_recognition_nominee();

create function eba_private.submit_weekly_recognition_review(
  p_week_start date, p_nominee_id uuid, p_impact text, p_contribution text, p_evidence_strength text
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  impact_note text := btrim(p_impact, E' \t\r\n');
  contribution_note text := btrim(p_contribution, E' \t\r\n');
  evidence_note text := btrim(p_evidence_strength, E' \t\r\n');
begin
  if not eba_private.hub_is_active() then raise insufficient_privilege; end if;

  if p_week_start is null or extract(isodow from p_week_start) <> 1
     or p_week_start > (now() at time zone 'Africa/Lagos')::date
     or impact_note is null or length(impact_note) not between 1 and 500
     or contribution_note is null or length(contribution_note) not between 1 and 500
     or evidence_note is null or length(evidence_note) not between 1 and 500 then
    return false;
  end if;

  perform pg_advisory_xact_lock(1760, p_week_start - date '2000-01-01');
  select m.role into caller_role from public.staff_memberships m
    where m.user_id = caller and m.status = 'active' and m.role in ('ceo', 'admin');
  if caller_role is null then raise insufficient_privilege; end if;

  if exists (select 1 from public.weekly_recognition where week_start = p_week_start) then return false; end if;
  if p_nominee_id is not null and (
    eba_private.recognition_employee_name(p_nominee_id) is null or not exists (
      select 1 from public.weekly_recognition_nominations n
      where n.week_start = p_week_start and n.nominee_id = p_nominee_id
    )
  ) then return false; end if;

  if exists (
    select 1 from public.weekly_recognition_reviews r
    where r.week_start = p_week_start and r.reviewer_id = caller and r.reviewer_role <> caller_role
  ) then return false; end if;

  insert into public.weekly_recognition_reviews as existing
    (week_start, reviewer_role, reviewer_id, nominee_id, impact, contribution, evidence_strength)
  values (p_week_start, caller_role, caller, p_nominee_id, impact_note, contribution_note, evidence_note)
  on conflict (week_start, reviewer_role) do update
  set nominee_id = excluded.nominee_id, impact = excluded.impact, contribution = excluded.contribution,
      evidence_strength = excluded.evidence_strength, submitted_at = statement_timestamp()
  where existing.reviewer_id = caller and eba_private.recognition_both_reviews(p_week_start);

  return found;
end;
$$;

create function public.submit_weekly_recognition_review(
  p_week_start date, p_nominee_id uuid, p_impact text, p_contribution text, p_evidence_strength text
)
returns boolean language sql security invoker set search_path = ''
as $$ select eba_private.submit_weekly_recognition_review(p_week_start, p_nominee_id, p_impact, p_contribution, p_evidence_strength); $$;

-- Replace the implementation behind the existing RPC, including direct callers.
create or replace function eba_private.publish_weekly_recognition(p_week_start date, p_winner_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  clean_reason text := btrim(p_reason, E' \t\r\n');
  winner text;
begin
  if not eba_private.recognition_admin() then
    raise insufficient_privilege using message = 'Only an active Admin can publish recognition';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1
     or p_week_start > (now() at time zone 'Africa/Lagos')::date
     or p_winner_id is null or clean_reason is null or length(clean_reason) not between 1 and 240 then
    return false;
  end if;

  perform pg_advisory_xact_lock(1760, p_week_start - date '2000-01-01');
  if not eba_private.recognition_admin() then raise insufficient_privilege; end if;

  if (
    select count(*) from public.weekly_recognition_reviews r
    where r.week_start = p_week_start and r.nominee_id = p_winner_id
  ) <> 2 then return false; end if;

  -- Lock the eligibility row until the award commits.
  perform 1 from public.staff_memberships m join auth.users u on u.id = m.user_id
    where m.user_id = p_winner_id and m.role = 'staff' and m.status = 'active'
      and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
    for share of m, u;
  if not found then return false; end if;
  winner := eba_private.recognition_employee_name(p_winner_id);
  if winner is null then return false; end if;

  insert into public.weekly_recognition (week_start, winner_id, winner_name, reason, published_by)
  values (p_week_start, p_winner_id, winner, clean_reason, auth.uid())
  on conflict (week_start) do nothing;

  return found;
end;
$$;

revoke all on function eba_private.recognition_employee_name(uuid), eba_private.validate_recognition_nominee(),
  eba_private.submit_weekly_recognition_review(date, uuid, text, text, text),
  public.submit_weekly_recognition_review(date, uuid, text, text, text) from public, anon, authenticated;
grant execute on function eba_private.submit_weekly_recognition_review(date, uuid, text, text, text),
  public.submit_weekly_recognition_review(date, uuid, text, text, text) to authenticated;

commit;
