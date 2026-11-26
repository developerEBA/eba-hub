import Link from "next/link";
import { createStaffClient } from "../../../lib/staff-auth";
import { departmentNames, generalId } from "../connect/model";
import { DashboardIcon } from "../navigation";
import { MarkRead, NotificationUpdates } from "./controls";
import { clientDirectoryPath } from "../clients/directory";
import { reminderLabel, type ReminderStage } from "../../../lib/calendar-reminders/model";
import { validMeetUrl } from "../calendar/meet-model";
import { NotificationJoin } from "../calendar/notification-join";

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Lagos" });
async function inboxTime() { return Date.now(); }
type InboxItem = {
  id:number; approval_id:string|null; conversation_id:string|null; created_at:string; read_at:string|null;
  is_mention:boolean; client_message_id:number|null; client_conversation_messages:{client_id:string}|null;
  calendar_occurrence_id?:string|null; calendar_lead_minutes?:ReminderStage;
  game_room_id?:string|null;
  calendar_occurrences?:{id:string;title:string;starts_at:string;ends_at:string;status:"scheduled"|"cancelled";join_url:string|null;joining_closed_at?:string|null}|null;
};
export async function NotificationBell({role}:{role:"CEO"|"Admin"|"HOD"}) {
  const client=await createStaffClient();
  if(!client)return null;
  const legacy="id,approval_id,conversation_id,created_at,read_at,is_mention,client_message_id,client_conversation_messages(client_id)";
  const load=(columns:string)=>client.from("hub_notifications").select(columns).order("id",{ascending:false}).limit(25).overrideTypes<InboxItem[],{merge:false}>();
  const oldCalendarColumns=legacy+",calendar_occurrence_id,calendar_lead_minutes,calendar_occurrences(id,title,starts_at,ends_at,status,join_url)";
  const calendarColumns=legacy+",calendar_occurrence_id,calendar_lead_minutes,calendar_occurrences(id,title,starts_at,ends_at,status,join_url,joining_closed_at)";
  const [initial,unread,now]=await Promise.all([
    load(calendarColumns+",game_room_id"),
    client.from("hub_notifications").select("id",{count:"exact",head:true}).is("read_at",null),
    inboxTime(),
  ]);
  let recent=initial;
  if(recent.error&&["42703","PGRST204","PGRST200"].includes(recent.error.code))recent=await load(calendarColumns);
  if(recent.error&&["42703","PGRST204","PGRST200"].includes(recent.error.code))recent=await load(oldCalendarColumns);
  if(recent.error&&["42703","PGRST204","PGRST200"].includes(recent.error.code))recent=await load(legacy);
  const conversationIds=[...new Set((recent.data??[]).map(item=>item.conversation_id).filter((id):id is string=>Boolean(id)))];
  const {data:conversationRows}=conversationIds.length?await client.from("connect_conversations")
    .select("id,room_type,department").in("id",conversationIds):{data:[]};
  const conversations=new Map((conversationRows??[]).map((room)=>[room.id,room]));
  return <details className="eba-notifications">
    {!unread.error && <NotificationUpdates latestUnreadId={Math.max(0,...(recent.data??[]).filter(item=>!item.read_at).map(item=>item.id))}/>}
    <summary aria-label={unread.error ? "Notifications, count unavailable" : `Notifications, ${unread.count??0} unread`}>
      <DashboardIcon path="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>
      {!unread.error && <span>{unread.count??0}</span>}
    </summary>
    <section aria-label="Notification inbox" className="eba-notifications__inbox">
      <header><strong>Notifications</strong>{Boolean(unread.count)&&<MarkRead id="all" label="Mark all as read"/>}</header>
      {recent.error ? <p>Notifications could not be loaded.</p> : !recent.data.length ? <p>No notifications yet.</p> : <ul>{recent.data.map(item=>{
        if(item.game_room_id)return <li key={item.id} data-unread={!item.read_at}>
          <Link prefetch={false} href={`/dashboard/games?room=${item.game_room_id}`}>You’re invited to a game<time dateTime={item.created_at}>{dateTime.format(new Date(item.created_at))}</time></Link>
          {!item.read_at&&<MarkRead id={item.id} label="Mark read"/>}
        </li>;
        if(item.calendar_occurrence_id){
          const meeting=item.calendar_occurrences;
          if(!meeting)return null;
          const cancelled=meeting.status==="cancelled";
          return <li key={item.id} data-unread={!item.read_at} className="eba-notifications__calendar">
            <div><Link prefetch={false} href={`/dashboard/calendar?meeting=${meeting.id}`}>
              <strong>{meeting.title}</strong>
              <span>{cancelled?"Meeting cancelled":reminderLabel(item.calendar_lead_minutes!,meeting.starts_at,now)}</span>
              <time dateTime={meeting.starts_at}>{dateTime.format(new Date(meeting.starts_at))} · Lagos</time>
            </Link>
            {!cancelled&&validMeetUrl(meeting.join_url)&&<NotificationJoin meeting={meeting}/>}</div>
            {!item.read_at&&<MarkRead id={item.id} label="Mark read"/>}
          </li>;
        }
        const room=conversations.get(item.conversation_id??"");
        const department=room?.room_type==="department"?departmentNames[room.department??""]??room.department:"";
        const message=item.client_conversation_messages;
        const href=item.client_message_id ? {pathname:message?clientDirectoryPath+"/"+message.client_id:clientDirectoryPath,query:{tab:"messages"}}
          :item.approval_id?{pathname:"/dashboard/approvals",query:{request:item.approval_id}}:{pathname:"/dashboard/connect",query:{chat:item.conversation_id}};
        return <li key={item.id} data-unread={!item.read_at}><Link prefetch={false} href={href}>
          {item.client_message_id?"New client message":item.approval_id?"New approval request":item.is_mention?"You were mentioned in Connect":item.conversation_id===generalId?"New message in EBA General":department?"New message in "+department:room?.room_type==="legacy_shared"?"Message in archived Connect history":"New direct message"}
          <time dateTime={item.created_at}>{dateTime.format(new Date(item.created_at))}</time>
        </Link>{!item.read_at&&<MarkRead id={item.id} label="Mark read"/>}</li>;
      })}</ul>}
      <footer className="eba-notifications__announcement-links">{role!=="HOD"&&<Link href="/dashboard/announcements">Manage announcements</Link>}<Link href={role==="HOD"?"/dashboard/announcements":"/dashboard/announcements/history"}>{role==="HOD"?"Announcements":"Announcement history"}</Link></footer>
    </section>
  </details>;
}
