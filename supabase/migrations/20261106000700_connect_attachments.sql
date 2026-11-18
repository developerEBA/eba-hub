begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('connect-attachments', 'connect-attachments', false, 4000000,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

alter table public.connect_messages
  add column attachment_path text unique,
  add column attachment_name text,
  add column attachment_size integer,
  add column attachment_mime text,
  add column attachment_caption text,
  drop constraint connect_message_payload,
  add constraint connect_message_payload check (
    (
      kind in ('text', 'sticker', 'voice')
      and attachment_path is null and attachment_name is null and attachment_size is null
      and attachment_mime is null and attachment_caption is null
      and (
        (kind = 'text' and audio_path is null)
        or (kind = 'sticker' and audio_path is null and body in ('celebrate', 'thanks', 'great-work', 'team'))
        or (kind = 'voice' and body = 'Voice note' and audio_path is not null
          and audio_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$')
      )
    )
    or (
      kind in ('photo', 'document') and audio_path is null
      and attachment_path is not null and attachment_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
      and attachment_name is not null and length(attachment_name) between 1 and 180
      and attachment_size is not null and attachment_size between 1 and 4000000
      and attachment_mime is not null
      and (attachment_caption is null or length(attachment_caption) <= 1000)
      and ((kind = 'photo' and attachment_mime in ('image/jpeg', 'image/png', 'image/webp'))
        or (kind = 'document' and attachment_mime = 'application/pdf'))
    )
  );

grant insert (attachment_path, attachment_name, attachment_size, attachment_mime, attachment_caption)
  on public.connect_messages to authenticated;

create policy "Participants read linked Connect attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'connect-attachments'
  and exists (
    select 1 from public.connect_messages m
    where m.attachment_path = storage.objects.name
      and eba_private.connect_can_read(m.conversation_id)
  )
);

create function eba_private.validate_connect_attachment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from storage.objects file
    where file.bucket_id = 'connect-attachments' and file.name = new.attachment_path
      and split_part(file.name, '/', 1) = new.conversation_id::text
      and split_part(file.name, '/', 2) = new.sender_id::text
      and file.metadata ->> 'mimetype' = new.attachment_mime
      and file.metadata ->> 'size' = new.attachment_size::text
  ) then
    raise check_violation using message = 'Attachment upload unavailable';
  end if;
  return new;
end;
$$;

revoke all on function eba_private.validate_connect_attachment() from public, anon, authenticated;
create trigger validate_connect_attachment before insert on public.connect_messages
  for each row when (new.kind in ('photo', 'document')) execute function eba_private.validate_connect_attachment();

commit;
