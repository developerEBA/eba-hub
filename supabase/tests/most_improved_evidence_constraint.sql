\set ON_ERROR_STOP on
begin;

do $require_repaired_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.period_recognition_nominations'::regclass
      and conname = 'period_recognition_improvement_evidence_check'
      and convalidated
  ) then
    raise exception 'Apply the Most Improved evidence repair migration before running this test.';
  end if;
end;
$require_repaired_constraint$;

-- LIKE INCLUDING CONSTRAINTS copies the actual validated CHECK expression into
-- a temporary test table. The fixture does not insert or change real records.
create temporary table most_improved_constraint_test
  (like public.period_recognition_nominations including defaults including constraints);

create function pg_temp.expect_most_improved_rejection(
  test_label text, p_before_date date, p_after_date date,
  p_before_evidence text, p_after_evidence text
) returns void language plpgsql as $$
begin
  begin
    insert into pg_temp.most_improved_constraint_test(
      award_type,period_start,contributor_ids,what_they_did,collaboration,who_benefited,what_changed,
      evidence_date,evidence_url,submitted_by,before_date,after_date,before_evidence,after_evidence
    ) values (
      'most_improved_month',date '2026-01-01',array[gen_random_uuid()],
      'Contribution','Collaboration','Beneficiaries','Result',date '2026-01-20','https://example.invalid/evidence',
      gen_random_uuid(),p_before_date,p_after_date,p_before_evidence,p_after_evidence
    );
    raise exception 'TEST FAILURE: % was accepted',test_label;
  exception when check_violation then
    raise notice 'PASS: rejected %',test_label;
  end;
end;
$$;

select pg_temp.expect_most_improved_rejection('missing before_date',null,date '2026-01-20','before','after');
select pg_temp.expect_most_improved_rejection('missing after_date',date '2026-01-10',null,'before','after');
select pg_temp.expect_most_improved_rejection('missing before_evidence',date '2026-01-10',date '2026-01-20',null,'after');
select pg_temp.expect_most_improved_rejection('missing after_evidence',date '2026-01-10',date '2026-01-20','before',null);
select pg_temp.expect_most_improved_rejection('blank before_evidence',date '2026-01-10',date '2026-01-20',E' \t\r\n','after');
select pg_temp.expect_most_improved_rejection('blank after_evidence',date '2026-01-10',date '2026-01-20','before','  ');
select pg_temp.expect_most_improved_rejection('overlong before_evidence',date '2026-01-10',date '2026-01-20',repeat('x',1201),'after');
select pg_temp.expect_most_improved_rejection('overlong after_evidence',date '2026-01-10',date '2026-01-20','before',repeat('x',1201));
select pg_temp.expect_most_improved_rejection('reversed dates',date '2026-01-21',date '2026-01-20','before','after');
select pg_temp.expect_most_improved_rejection('before date before selected month',date '2025-12-31',date '2026-01-20','before','after');
select pg_temp.expect_most_improved_rejection('before date after selected month',date '2026-02-01',date '2026-02-02','before','after');
select pg_temp.expect_most_improved_rejection('after date before selected month',date '2025-12-10',date '2025-12-20','before','after');
select pg_temp.expect_most_improved_rejection('after date after selected month',date '2026-01-10',date '2026-02-01','before','after');

insert into pg_temp.most_improved_constraint_test(
  award_type,period_start,contributor_ids,what_they_did,collaboration,who_benefited,what_changed,
  evidence_date,evidence_url,submitted_by,before_date,after_date,before_evidence,after_evidence
) values (
  'most_improved_month',date '2026-01-01',array[gen_random_uuid()],
  'Contribution','Collaboration','Beneficiaries','Result',date '2026-01-20','https://example.invalid/evidence',
  gen_random_uuid(),date '2026-01-10',date '2026-01-20','Before evidence','After evidence'
);
do $$ begin raise notice 'PASS: valid in-month before/after evidence was accepted'; end $$;

rollback;
