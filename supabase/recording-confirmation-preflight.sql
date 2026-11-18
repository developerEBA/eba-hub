-- READ ONLY. No Google calls, credential values, recordings or metadata writes.
begin transaction read only;
select to_regprocedure('public.calendar_set_audience(uuid,uuid,integer,text)') audience_migration,
 to_regprocedure('public.calendar_reminder_account_active(uuid)') eligibility_helper,
 to_regprocedure('public.calendar_confirm_recording(uuid,uuid,integer,text,bigint,text,boolean)') confirmation_migration;
select name,has_column_privilege('service_role','public.calendar_occurrences',name,'SELECT') required_read
from unnest(array['id','version','status','join_url','provider_calendar_id','provider_event_id']) name;
select has_column_privilege('service_role','public.calendar_occurrences','recording_status','UPDATE') required_status_write;
rollback;
