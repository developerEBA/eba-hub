begin;

alter table public.connect_messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  drop constraint connect_message_payload,
  add constraint connect_message_payload check (
    (
      kind in ('text', 'sticker', 'voice')
      and attachment_path is null and attachment_name is null and attachment_size is null
      and attachment_mime is null and attachment_caption is null
      and (
        (kind = 'text' and audio_path is null)
        or (kind = 'sticker' and audio_path is null and body in ('celebrate', 'thanks', 'great-work', 'team', 'hello', 'laugh', 'love', 'yes', 'no', 'wow', 'fire', 'idea', 'coffee', 'rocket', 'party', 'clap', 'strong', 'happy', 'focus', 'done', 'cheers', 'good-morning', 'heart-eyes', 'sparkle'))
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

alter table public.hub_notifications add column is_mention boolean not null default false;

create function eba_private.notify_connect_mentions()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind <> 'text' or new.deleted_at is not null then return new; end if;

  insert into public.hub_notifications as existing (recipient_id, message_id, conversation_id, is_mention)
  select distinct member.user_id, new.id, new.conversation_id, true
  from regexp_matches(new.body, '@\{([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\}', 'gi') as token(match)
  join public.connect_profiles member on member.user_id = token.match[1]::uuid
  join public.connect_conversations room on room.id = new.conversation_id
  where member.user_id <> new.sender_id
    and (room.member_low is null or member.user_id in (room.member_low, room.member_high))
    and eba_private.connect_has_joined(member.user_id)
  on conflict (recipient_id, message_id) do update
  set is_mention = true, read_at = null
  where not existing.is_mention;
  return new;
end;
$$;

-- PostgreSQL runs triggers of the same kind alphabetically. Upgrade the regular alert after it is created.
create trigger notify_connect_mentions
after insert or update of body on public.connect_messages
for each row execute function eba_private.notify_connect_mentions();

create function eba_private.connect_change_message(message bigint, operation text, replacement text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if operation = 'edit' then
    if replacement is null or length(btrim(replacement, E' \t\r\n')) not between 1 and 4000
      or length(replacement) > 4000 then return false; end if;

    update public.connect_messages m
    set body = replacement, edited_at = statement_timestamp()
    where m.id = message and m.sender_id = auth.uid() and m.kind = 'text'
      and m.deleted_at is null and eba_private.connect_can_read(m.conversation_id);
    return found;
  elsif operation = 'delete' then
    update public.connect_messages m
    set kind = 'text', body = 'Message deleted', deleted_at = statement_timestamp(),
      audio_path = null, attachment_path = null, attachment_name = null, attachment_size = null,
      attachment_mime = null, attachment_caption = null
    where m.id = message and m.sender_id = auth.uid() and m.deleted_at is null
      and eba_private.connect_can_read(m.conversation_id);
    if not found then return false; end if;

    update public.hub_notifications n set read_at = statement_timestamp()
    where n.message_id = message and n.read_at is null;
    return true;
  end if;
  return false;
end;
$$;

create function public.connect_change_message(message bigint, operation text, replacement text)
returns boolean language sql security invoker set search_path = ''
as $$ select eba_private.connect_change_message(message, operation, replacement); $$;

revoke all on function eba_private.notify_connect_mentions(), eba_private.connect_change_message(bigint, text, text),
  public.connect_change_message(bigint, text, text) from public, anon, authenticated;
grant execute on function eba_private.connect_change_message(bigint, text, text),
  public.connect_change_message(bigint, text, text) to authenticated;

create or replace function public.connect_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select m.conversation_id, count(*)
  from public.connect_messages m
  join public.connect_profiles p on p.user_id = (select auth.uid())
  left join public.connect_message_reads r on r.message_id = m.id and r.user_id = p.user_id
  where m.sender_id <> p.user_id and m.sent_at >= p.first_signed_in_at
    and r.message_id is null and m.deleted_at is null
  group by m.conversation_id;
$$;

commit;
