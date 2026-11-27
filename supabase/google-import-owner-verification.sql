-- READ ONLY, after the verified-owner forward migration. No mapping is created.
begin transaction read only;
select has_table_privilege('authenticated','public.calendar_google_import_owners','SELECT') browser_read_must_be_false,
 has_table_privilege('authenticated','public.calendar_google_import_owners','INSERT') browser_write_must_be_false,
 has_function_privilege('authenticated','public.calendar_google_import_owner(text,text)','EXECUTE') browser_resolve_must_be_false,
 has_function_privilege('service_role','public.calendar_google_import_owner(text,text)','EXECUTE') server_resolve;
select exists(select 1 from public.calendar_google_import_owners v
 join public.google_organizer_connection c on c.singleton=v.singleton
 join auth.users u on u.id=v.owner_id join public.staff_memberships m on m.user_id=u.id
 where c.enabled and c.status='connected' and c.email='google-organizer@example.test'
 and v.google_email=c.email and v.google_subject=c.subject and v.connected_at=c.connected_at
 and u.email='hub-admin-test@enibrand.com' and m.role='admin' and public.calendar_reminder_account_active(u.id)
) current_durable_mapping_valid;
rollback;
