begin;

create function eba_private.require_leave_document()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from unnest(new.attachment_names) as attachment(filename)
    join storage.objects as file
      on file.bucket_id = 'approval-request-files'
      and file.name = new.id::text || '/' || attachment.filename
    where attachment.filename ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}$'
      and right(attachment.filename, 1) <> '.'
  ) then
    raise check_violation using
      message = 'A leave request requires an uploaded supporting document.',
      constraint = 'approval_requests_uploaded_leave_document';
  end if;
  return new;
end;
$$;

revoke all on function eba_private.require_leave_document() from public, anon, authenticated;

create trigger require_leave_document
before insert or update of id, request_type, attachment_names
on public.approval_requests
for each row when (new.request_type = 'leave')
execute function eba_private.require_leave_document();

commit;
