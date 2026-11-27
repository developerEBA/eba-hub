begin;

do $$
declare
  names text[];
  failed_constraint text;
begin
  foreach names slice 1 in array array[['missing-test-document.txt'], [null::text]]
  loop
    begin
      insert into public.approval_requests
        (title, request_type, department, requester_name, message, start_date, end_date, attachment_names)
      values
        ('DEV — leave validation probe', 'leave', 'Events', 'Development fixture',
         'Validation probe', '2026-11-16', '2026-11-17', array_remove(names, null));
      raise exception 'Leave validation failed: request without a stored document was accepted';
    exception when check_violation then
      get stacked diagnostics failed_constraint = constraint_name;
      if failed_constraint <> 'approval_requests_uploaded_leave_document' then raise; end if;
    end;
  end loop;

  update public.approval_requests
  set attachment_names = attachment_names
  where id = 'eba00000-0000-4000-8000-000000000303';
  if not found then raise exception 'Load the development leave fixture first'; end if;
  raise notice 'Leave document checks passed';
end;
$$;

rollback;
