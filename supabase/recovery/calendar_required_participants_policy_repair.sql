-- Use ONLY when the catalog-state check reports PARTIAL and all required
-- participant migration objects exist except for the final audience policy.
-- This is a transaction-safe compatibility repair, not the normal migration.
begin;

do $$ begin
  if to_regclass('public.hub_notifications') is null
    or to_regclass('public.calendar_occurrences') is null
    or to_regclass('public.calendar_occurrence_participant_sources') is null
    or to_regclass('public.calendar_google_attendee_snapshots') is null
    or to_regprocedure('public.calendar_access()') is null
    or to_regprocedure('public.calendar_reconcile_required_participants(uuid,boolean)') is null
    or to_regprocedure('public.calendar_google_import_v1(text,text,jsonb)') is null
    or to_regprocedure('public.calendar_mutate_v1(uuid,uuid,text,uuid,text,integer,jsonb)') is null
    or to_regprocedure('public.calendar_hod_create_v1(uuid,uuid,jsonb)') is null
    or to_regprocedure('eba_private.calendar_required_source(uuid)') is null
    or to_regprocedure('eba_private.calendar_current_member()') is null then
    raise exception 'Required-meeting migration is incomplete; do not run the policy-only repair';
  end if;
end $$;

drop policy if exists "Calendar alerts require current occurrence visibility" on public.hub_notifications;
create policy "Calendar alerts require current occurrence visibility" on public.hub_notifications
  as restrictive for all to authenticated
  using (calendar_occurrence_id is null or ((select public.calendar_access()) and exists(
    select 1 from public.calendar_occurrences o where o.id=calendar_occurrence_id
      and o.reminder_revision=calendar_revision
      and (o.organizer_id=(select auth.uid()) or (select auth.uid())=any(o.attendee_ids)))))
  with check (calendar_occurrence_id is null or ((select public.calendar_access()) and exists(
    select 1 from public.calendar_occurrences o where o.id=calendar_occurrence_id
      and o.reminder_revision=calendar_revision
      and (o.organizer_id=(select auth.uid()) or (select auth.uid())=any(o.attendee_ids)))));

notify pgrst,'reload schema';
commit;
