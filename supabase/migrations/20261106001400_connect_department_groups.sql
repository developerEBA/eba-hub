begin;

-- Shared channels use the same active, signed-in staff access rules as General.
-- Private chats still require two distinct participants.
alter table public.connect_conversations drop constraint connect_conversations_check;
alter table public.connect_conversations add constraint connect_conversations_check check (
  (id in (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000006'
  )) = (member_low is null and member_high is null)
  and (
    (member_low is null and member_high is null)
    or (member_low is not null and member_high is not null and member_low < member_high)
  )
);

insert into public.connect_conversations (id) values
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000005'),
  ('00000000-0000-4000-8000-000000000006');

commit;
