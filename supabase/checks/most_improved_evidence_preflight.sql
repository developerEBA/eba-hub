with schema_state as (
  select to_regclass('public.period_recognition_nominations') as relation_oid,
    (select count(*) = 7 from information_schema.columns
      where table_schema='public' and table_name='period_recognition_nominations'
        and column_name in ('award_type','period_start','contributor_ids','before_date','after_date','before_evidence','after_evidence')) as columns_present
), row_report as (
  select relation_oid,columns_present,
    case when relation_oid is not null and columns_present then pg_catalog.query_to_xml($query$
      select count(*) as total_rows,
        count(*) filter (where before_date is null or after_date is null or before_evidence is null or after_evidence is null) as missing_fields,
        count(*) filter (where before_evidence is null or after_evidence is null
          or length(btrim(before_evidence,E' \t\r\n')) not between 1 and 1200
          or length(btrim(after_evidence,E' \t\r\n')) not between 1 and 1200) as invalid_evidence,
        count(*) filter (where before_date is null or after_date is null or before_date >= after_date) as invalid_date_order,
        count(*) filter (where before_date is null or after_date is null
          or before_date < period_start or before_date >= (period_start + interval '1 month')::date
          or after_date < period_start or after_date >= (period_start + interval '1 month')::date) as dates_outside_month,
        count(*) filter (where cardinality(contributor_ids) is distinct from 1) as invalid_contributors,
        count(*) filter (where before_date is null or after_date is null or before_evidence is null or after_evidence is null
          or cardinality(contributor_ids) is distinct from 1
          or length(btrim(before_evidence,E' \t\r\n')) not between 1 and 1200
          or length(btrim(after_evidence,E' \t\r\n')) not between 1 and 1200
          or before_date >= after_date
          or before_date < period_start or before_date >= (period_start + interval '1 month')::date
          or after_date < period_start or after_date >= (period_start + interval '1 month')::date) as invalid_rows
      from public.period_recognition_nominations where award_type='most_improved_month'
    $query$,false,true,'') end as report
), parsed as (
  select relation_oid is not null as table_present,columns_present,
    case when report is null then null else ((xpath('/table/row/total_rows/text()',report))[1]::text)::bigint end as total_rows,
    case when report is null then null else ((xpath('/table/row/missing_fields/text()',report))[1]::text)::bigint end as missing_fields,
    case when report is null then null else ((xpath('/table/row/invalid_evidence/text()',report))[1]::text)::bigint end as invalid_evidence,
    case when report is null then null else ((xpath('/table/row/invalid_date_order/text()',report))[1]::text)::bigint end as invalid_date_order,
    case when report is null then null else ((xpath('/table/row/dates_outside_month/text()',report))[1]::text)::bigint end as dates_outside_month,
    case when report is null then null else ((xpath('/table/row/invalid_contributors/text()',report))[1]::text)::bigint end as invalid_contributors,
    case when report is null then null else ((xpath('/table/row/invalid_rows/text()',report))[1]::text)::bigint end as invalid_rows
  from row_report
)
select case when not table_present or not columns_present then 'SCHEMA_MISSING'
            when invalid_rows=0 then 'READY'
            else 'RECONCILE' end as status,
  table_present,columns_present,total_rows,invalid_rows,missing_fields,invalid_evidence,invalid_date_order,dates_outside_month,invalid_contributors,
  'Counts may overlap. This query returns aggregates only; it makes no changes.' as note
from parsed;
