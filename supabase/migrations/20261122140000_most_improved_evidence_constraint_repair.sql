begin;

-- Fail closed if historical Most Improved records need reconciliation. This
-- migration reports aggregate counts only and never rewrites recognition data.
do $preflight$
declare
  total_rows bigint;
  invalid_rows bigint;
  missing_fields bigint;
  invalid_evidence bigint;
  invalid_dates bigint;
  out_of_month bigint;
  invalid_contributors bigint;
begin
  select count(*),
    count(*) filter (where before_date is null or after_date is null or before_evidence is null or after_evidence is null),
    count(*) filter (where before_evidence is null or after_evidence is null
      or length(btrim(before_evidence, E' \t\r\n')) not between 1 and 1200
      or length(btrim(after_evidence, E' \t\r\n')) not between 1 and 1200),
    count(*) filter (where before_date is null or after_date is null or before_date >= after_date),
    count(*) filter (where before_date is null or after_date is null
      or before_date < period_start or before_date >= (period_start + interval '1 month')::date
      or after_date < period_start or after_date >= (period_start + interval '1 month')::date),
    count(*) filter (where cardinality(contributor_ids) is distinct from 1) as bad_contributors,
    count(*) filter (where before_date is null or after_date is null or before_evidence is null or after_evidence is null
      or cardinality(contributor_ids) is distinct from 1
      or length(btrim(before_evidence, E' \t\r\n')) not between 1 and 1200
      or length(btrim(after_evidence, E' \t\r\n')) not between 1 and 1200
      or before_date >= after_date
      or before_date < period_start or before_date >= (period_start + interval '1 month')::date
      or after_date < period_start or after_date >= (period_start + interval '1 month')::date)
  into total_rows, missing_fields, invalid_evidence, invalid_dates, out_of_month, invalid_contributors, invalid_rows
  from public.period_recognition_nominations
  where award_type = 'most_improved_month';

  if invalid_rows > 0 then
    raise exception using
      errcode = '23514',
      message = 'Most Improved evidence repair stopped: existing rows need reconciliation.',
      detail = format('Aggregate counts only: total=%s, invalid=%s, missing_fields=%s, invalid_evidence=%s, invalid_dates=%s, out_of_month=%s, invalid_contributors=%s.',
        total_rows, invalid_rows, missing_fields, invalid_evidence, invalid_dates, out_of_month, invalid_contributors),
      hint = 'Review the read-only aggregate preflight. Reconcile each invalid row from verifiable source evidence without deleting records or changing dates silently, then rerun this migration.';
  end if;
end;
$preflight$;

alter table public.period_recognition_nominations
  drop constraint if exists period_recognition_improvement_evidence_check;

alter table public.period_recognition_nominations
  add constraint period_recognition_improvement_evidence_check check (
    award_type <> 'most_improved_month'
    or (
      cardinality(contributor_ids) = 1
      and before_date is not null
      and after_date is not null
      and before_evidence is not null
      and after_evidence is not null
      and length(btrim(before_evidence, E' \t\r\n')) between 1 and 1200
      and length(btrim(after_evidence, E' \t\r\n')) between 1 and 1200
      and before_date < after_date
      and before_date >= period_start
      and before_date < (period_start + interval '1 month')::date
      and after_date >= period_start
      and after_date < (period_start + interval '1 month')::date
    )
  ) not valid;

alter table public.period_recognition_nominations
  validate constraint period_recognition_improvement_evidence_check;

commit;
