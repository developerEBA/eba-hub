-- Requires Parts 1-3 and existing games. No invitations or alerts sent by migration.
begin;
alter table public.hub_notifications add column game_room_id uuid references public.game_rooms(id) on delete cascade;
alter table public.hub_notifications add constraint hub_game_invitation_recipient_fk
 foreign key(game_room_id,recipient_id) references public.game_invites(room_id,user_id) on delete cascade;
do $$ declare old_check text; begin
 select pg_get_expr(conbin,conrelid) into old_check from pg_constraint
 where conrelid='public.hub_notifications'::regclass and conname='hub_notifications_check';
 if old_check is null then raise exception 'Notification check missing; inspect preflight'; end if;
 alter table public.hub_notifications drop constraint hub_notifications_check;
 execute format('alter table public.hub_notifications add constraint hub_notifications_check check (
   (game_room_id is null and (%s)) or (game_room_id is not null and approval_id is null and message_id is null
   and conversation_id is null and client_message_id is null and calendar_occurrence_id is null
   and calendar_revision is null and calendar_lead_minutes is null))',old_check);
end $$;
create unique index hub_game_invitation_once on public.hub_notifications(recipient_id,game_room_id) where game_room_id is not null;
grant insert(recipient_id,game_room_id,created_at),select(game_room_id) on public.hub_notifications to service_role;
create policy "Game alerts require current invitation" on public.hub_notifications as restrictive for all to authenticated
 using(game_room_id is null or exists(select 1 from public.game_invites i where i.room_id=game_room_id and i.user_id=(select auth.uid())))
 with check(game_room_id is null or exists(select 1 from public.game_invites i where i.room_id=game_room_id and i.user_id=(select auth.uid())));
create function public.notify_game_invitation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if public.calendar_reminder_account_active(new.user_id) and exists(select 1 from public.game_rooms where id=new.room_id and status='waiting') then
   insert into public.hub_notifications(recipient_id,game_room_id) values(new.user_id,new.room_id)
     on conflict(recipient_id,game_room_id) where game_room_id is not null do nothing;
 end if;
 return new;
end $$;
revoke all on function public.notify_game_invitation() from public,anon,authenticated;
create trigger game_invitation_notification after insert on public.game_invites for each row execute function public.notify_game_invitation();
notify pgrst,'reload schema';
commit;
