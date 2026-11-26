import { Suspense } from "react";
import DashboardLoading from "../loading";
import Link from "next/link";
import { requireHodDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import { Members, Person } from "./chat-controls";
import { MediaComposer } from "./media-composer";
import { ChatEditing } from "./chat-editing";
import { ChatHistory } from "./chat-history";
import { chatDayLabels, loadChatHistory } from "./history-data";
import { departmentNames, generalId, isConversationId, type ConnectProfile, type ConnectRoom, type UnreadConversation } from "./model";

const route = "/dashboard/connect";
type Query = Record<string, string | string[] | undefined>;

export default function Connect({ searchParams }: { searchParams: Promise<Query> }) {
  return <Suspense fallback={<DashboardLoading />}><ProtectedConnect searchParams={searchParams} /></Suspense>;
}

async function ProtectedConnect({ searchParams }: { searchParams: Promise<Query> }) {
  const { client, role, user } = await requireHodDashboardAccess();
  const params = await searchParams;
  const roomId = params.list !== "1" && isConversationId(params.chat) ? params.chat.toLowerCase() : null;
  const showList = roomId === null;
  const [directory, conversations, counts] = await Promise.all([
    client.from("connect_profiles").select("user_id,display_name,avatar_url").order("display_name").returns<ConnectProfile[]>(),
    client.from("connect_conversations").select("id,room_type,department,archived_at,member_low,member_high")
      .order("room_type").order("department").order("id").returns<ConnectRoom[]>(),
    client.rpc("connect_unread_counts"),
  ]);
  const profiles = new Map(directory.data?.map((profile) => [profile.user_id, profile]));
  const members = directory.data ?? [];
  const rooms = conversations.data ?? [];
  const unreadRows: UnreadConversation[] = Array.isArray(counts.data) ? counts.data : [];
  const unread = new Map(unreadRows.map((row) => [row.conversation_id, Number(row.unread_count)]));
  const selected = rooms.find(({ id }) => id === roomId);
  const general = selected?.room_type === "general";
  const department = selected?.room_type === "department" && selected.department
    ? departmentNames[selected.department] ?? selected.department : null;
  const archived = selected?.room_type === "legacy_shared";
  const groupRoom = selected ? selected.room_type !== "dm" : false;
  const partner = selected?.room_type === "dm"
    ? profiles.get(selected.member_low === user.id ? selected.member_high ?? "" : selected.member_low ?? "") : undefined;
  const hasAccess = profiles.has(user.id) && rooms.some(({ id, room_type }) => id === generalId && room_type === "general");
  const [messages, departmentMembersResult] = await Promise.all([
    roomId && selected && hasAccess ? loadChatHistory(client, roomId) : null,
    roomId && department ? client.rpc("connect_department_members", { room: roomId }).returns<ConnectProfile[]>() : Promise.resolve(null),
  ]);
  const departmentMembers: ConnectProfile[] = Array.isArray(departmentMembersResult?.data)
    ? departmentMembersResult.data : [];
  const { today, yesterday } = chatDayLabels();
  const roomTitle = general ? "EBA General" : department ?? (archived
    ? `${selected?.department ? departmentNames[selected.department] ?? selected.department : "Department"} history`
    : partner?.display_name ?? "Direct message");

  return <DashboardShell role={role} section="connect" fullScreen={!showList}>
    <section className={showList ? "eba-connect eba-connect--inbox" : "eba-connect"}
      aria-label={!showList ? roomTitle : undefined} aria-labelledby={showList ? "connect-title" : undefined}>
      {showList && <header className="eba-connect__landing-heading"><h1 id="connect-title">Connect</h1></header>}
      {directory.error || conversations.error ? (
        <p className="eba-connect__notice" role="status">Connect could not be loaded. Check that the Connect and private-room migrations are applied, then refresh.</p>
      ) : !hasAccess ? (
        <p className="eba-connect__notice" role="status">Connect access has not been recorded. Sign out and sign in again once setup is complete.</p>
      ) : <div className="eba-connect__grid" data-list={showList} data-general={groupRoom}>
        {showList && <div className="eba-connect__board">
          <nav className="eba-connect__rooms" aria-label="Company channel">
            <Link className="eba-connect__general-row" href={{ pathname: route, query: { chat: generalId } }}>
              <span className="eba-connect__channel-mark" aria-hidden="true">#</span>
              <strong>EBA General <small>Company-wide conversation</small></strong>
              {!counts.error && Boolean(unread.get(generalId)) && <span className="eba-connect__unread" aria-label={`${unread.get(generalId)} unread`}>{unread.get(generalId)}</span>}
            </Link>
          </nav>
          <nav className="eba-connect__rooms" aria-labelledby="connect-groups">
            <h2 id="connect-groups">Departments</h2>
            {rooms.filter((room) => room.room_type === "department").map((room) => <Link key={room.id}
              href={{ pathname: route, query: { chat: room.id } }} aria-current={room.id === roomId ? "page" : undefined} prefetch={false}>
              <span className="eba-connect__channel-mark" aria-hidden="true">#</span>
              <strong>{departmentNames[room.department ?? ""] ?? room.department ?? "Department"}<small>Private department room</small></strong>
              {!counts.error && Boolean(unread.get(room.id)) && <span className="eba-connect__unread" aria-label={`${unread.get(room.id)} unread`}>{unread.get(room.id)}</span>}
            </Link>)}
            {!rooms.some((room) => room.room_type === "department") && <p>No private department rooms are available to this account.</p>}
            {rooms.some((room) => room.room_type === "legacy_shared") && <details className="eba-connect__legacy">
              <summary>Archived shared history</summary>
              {rooms.filter((room) => room.room_type === "legacy_shared").map((room) => <Link key={room.id}
                href={{ pathname: route, query: { chat: room.id } }} prefetch={false}>
                {room.department ? departmentNames[room.department] ?? room.department : "Unmapped"} · Read-only history
              </Link>)}
            </details>}
          </nav>
          <nav className="eba-connect__rooms" aria-labelledby="connect-direct">
            <h2 id="connect-direct">Direct messages</h2>
            {rooms.filter((room) => room.room_type === "dm").map((room) => {
              const other = profiles.get(room.member_low === user.id ? room.member_high ?? "" : room.member_low ?? "");
              return <Link key={room.id} href={{ pathname: route, query: { chat: room.id } }}
                aria-current={room.id === roomId ? "page" : undefined} prefetch={false}>
                <span className="eba-connect__channel-mark" aria-hidden="true">{other?.display_name.charAt(0).toUpperCase() || "?"}</span>
                <strong>{other?.display_name ?? "Former member"}</strong>
                {!counts.error && Boolean(unread.get(room.id)) && <span className="eba-connect__unread" aria-label={`${unread.get(room.id)} unread`}>{unread.get(room.id)}</span>}
              </Link>;
            })}
            {members.length <= 1 && <p>Waiting for team members to join</p>}
            {members.filter((member) => member.user_id !== user.id && !rooms.some((room) =>
              room.room_type === "dm" && (room.member_low === member.user_id || room.member_high === member.user_id)))
              .map((member) => <Person key={member.user_id} profile={member} isSelf={false} />)}
          </nav>
          {counts.error && <p className="eba-connect__notice" role="status">Unread counts are unavailable. Refresh to try again.</p>}
        </div>}
        {roomId && <article className="eba-connect__chat" aria-label="Selected conversation">
          {!selected && <Link href={route}>← Back to Connect</Link>}
          {!selected ? <p>This conversation is unavailable or you no longer have access.</p> : <>
            <div className="eba-connect__chat-header">
              <Link className="eba-connect__header-back" aria-label="Back to Connect" href={route}>←</Link>
              <div><h2>{roomTitle}</h2>
                {department && <p className="eba-connect__private-indicator">Private department room · active assigned members and CEO/Admin oversight</p>}
                {archived && <p className="eba-connect__private-indicator">Archived shared history · read-only · original eligible readers only</p>}
                {!general && !department && !archived && <p>Private conversation</p>}
              </div>
              {general && <Members members={members} userId={user.id} />}
              {department && (departmentMembersResult?.error
                ? <p role="status">Department members could not be loaded. Refresh to retry.</p>
                : <Members members={departmentMembers} userId={user.id} title={`${department} members`}
                  description="Private to active department assignments and CEO/Admin oversight." allowDirectMessage={false} />)}
            </div>
            <ChatEditing key={roomId}>
              {messages?.error || !messages ? <p role="status">Messages could not be loaded or access changed. Return to Connect and refresh.</p>
                : <ChatHistory key={`history-${roomId}`} conversation={roomId} latest={messages} members={members}
                  userId={user.id} general={groupRoom} visible={!showList} today={today} yesterday={yesterday}
                  unread={unread.get(roomId) ?? 0} />}
              <MediaComposer key={roomId} conversation={roomId} canSend={!archived && (groupRoom || Boolean(partner))}
                members={department ? departmentMembers.filter((member) => member.user_id !== user.id)
                  : groupRoom ? members.filter((member) => member.user_id !== user.id) : partner ? [partner] : []} />
            </ChatEditing>
          </>}
        </article>}
      </div>}
    </section>
  </DashboardShell>;
}
