import { Suspense } from "react";
import DashboardLoading from "../loading";
import Link from "next/link";
import { requireDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import { Members, Person } from "./chat-controls";
import { MediaComposer } from "./media-composer";
import { ChatEditing } from "./chat-editing";
import { ChatHistory } from "./chat-history";
import { chatDayLabels, loadChatHistory } from "./history-data";
import { departmentRooms, generalId, isConversationId, type ConnectProfile, type UnreadConversation } from "./model";

const route = "/dashboard/connect";

type Query = Record<string, string | string[] | undefined>;

export default function Connect({ searchParams }: { searchParams: Promise<Query> }) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <ProtectedConnect searchParams={searchParams} />
    </Suspense>
  );
}

async function ProtectedConnect({ searchParams }: { searchParams: Promise<Query> }) {
  const { client, role, user } = await requireDashboardAccess();
  const params = await searchParams;
  const roomId = params.list !== "1" && isConversationId(params.chat) ? params.chat.toLowerCase() : null;
  const showList = roomId === null;

  const [directory, conversations, counts] = await Promise.all([
    client.from("connect_profiles").select("user_id,display_name,avatar_url").order("display_name").returns<ConnectProfile[]>(),
    client.from("connect_conversations").select("id,member_low,member_high").order("id"),
    client.rpc("connect_unread_counts"),
  ]);

  const profiles = new Map(directory.data?.map((profile) => [profile.user_id, profile]));
  const members = directory.data ?? [];
  const rooms = conversations.data ?? [];
  const unreadRows: UnreadConversation[] = Array.isArray(counts.data) ? counts.data : [];
  const unread = new Map(unreadRows.map((row) => [row.conversation_id, Number(row.unread_count)]));
  const selected = rooms.find(({ id }) => id === roomId);
  const general = roomId === generalId;
  const department = departmentRooms.find(({ id }) => id === roomId);
  const shared = general || Boolean(department);
  const focusedChat = !showList;
  const partner = selected && !shared
    ? profiles.get(selected.member_low === user.id ? selected.member_high : selected.member_low)
    : undefined;
  const hasAccess = profiles.has(user.id) && rooms.some(({ id }) => id === generalId);

  const messages = roomId && selected && hasAccess ? await loadChatHistory(client, roomId) : null;
  const { today, yesterday } = chatDayLabels();
  return (
    <DashboardShell role={role} section="connect" fullScreen={focusedChat}>
      <section className={showList ? "eba-connect eba-connect--inbox" : "eba-connect"} aria-label={focusedChat ? general ? "EBA General" : department?.name ?? "Direct message" : undefined}
        aria-labelledby={focusedChat ? undefined : "connect-title"}>
        {showList && <header className="eba-connect__landing-heading">
          <h1 id="connect-title">Connect</h1>
        </header>}
        {directory.error || conversations.error ? (
          <p className="eba-connect__notice" role="status">Connect could not be loaded. Check that the Connect migration is applied.</p>
        ) : !hasAccess ? (
          <p className="eba-connect__notice" role="status">Connect access has not been recorded. Sign out and sign in again once setup is complete.</p>
        ) : (
          <div className="eba-connect__grid" data-list={showList} data-general={shared}>
            {showList && <div className="eba-connect__board">
              <nav className="eba-connect__rooms" aria-label="Company channel">
                <Link className="eba-connect__general-row" href={{ pathname: route, query: { chat: generalId } }}>
                  <span className="eba-connect__channel-mark" aria-hidden="true">#</span>
                  <strong>EBA General <small>Company-wide conversation</small></strong>
                  {!counts.error && Boolean(unread.get(generalId)) && <span className="eba-connect__unread" aria-label={`${unread.get(generalId) ?? 0} unread`}>{unread.get(generalId) ?? 0}</span>}
                </Link>
              </nav>
              <nav className="eba-connect__rooms" aria-labelledby="connect-groups">
                <h2 id="connect-groups">Department groups</h2>
                {departmentRooms.filter((group) => rooms.some((room) => room.id === group.id)).map((group) => (
                  <Link key={group.id} href={{ pathname: route, query: { chat: group.id } }}>
                    <span className="eba-connect__channel-mark" aria-hidden="true">#</span> <strong>{group.name}</strong>
                    {!counts.error && Boolean(unread.get(group.id)) && <span className="eba-connect__unread" aria-label={`${unread.get(group.id) ?? 0} unread`}>{unread.get(group.id) ?? 0}</span>}
                  </Link>
                ))}
                {!departmentRooms.some((group) => rooms.some((room) => room.id === group.id)) && <p>Department groups are not set up yet.</p>}
              </nav>
              <nav className="eba-connect__rooms" aria-labelledby="connect-direct">
                <h2 id="connect-direct">Direct messages</h2>
                {rooms.filter(({ member_low }) => member_low !== null).map((room) => {
                  const other = profiles.get(room.member_low === user.id ? room.member_high : room.member_low);
                  return (
                    <Link key={room.id} href={{ pathname: route, query: { chat: room.id } }}
                      aria-current={room.id === roomId ? "page" : undefined} prefetch={false}>
                      <span className="eba-connect__channel-mark" aria-hidden="true">{other?.display_name.charAt(0).toUpperCase() || "?"}</span>
                      <strong>{other?.display_name ?? "Former member"}</strong>
                      {!counts.error && Boolean(unread.get(room.id)) && <span className="eba-connect__unread" aria-label={`${unread.get(room.id) ?? 0} unread`}>{unread.get(room.id) ?? 0}</span>}
                    </Link>
                  );
                })}
                {members.length <= 1 && <p>Waiting for team members to join</p>}
                {members.filter((member) => member.user_id !== user.id && !rooms.some((room) =>
                  room.member_low === member.user_id || room.member_high === member.user_id)).map((member) => (
                    <Person key={member.user_id} profile={member} isSelf={false} />
                ))}
              </nav>
            </div>}
            {roomId && <article className="eba-connect__chat" aria-label="Selected conversation">
              {!selected && <Link href={route}>← Back to Connect</Link>}
              {!selected ? <p>This conversation is unavailable.</p> : (
                <>
                  <div className="eba-connect__chat-header">
                    <Link className="eba-connect__header-back" aria-label="Back to Connect" href={route}>←</Link>
                    <div>
                      <h2>{general ? "EBA General" : department?.name ?? partner?.display_name ?? "Former member"}</h2>
                      {!general && <p>{department ? "Department group" : "Private conversation"}</p>}
                    </div>
                    {general && <Members members={members} userId={user.id} />}
                  </div>
                  <ChatEditing key={roomId}>
                    {messages?.error || !messages ? <p role="status">Messages could not be loaded.</p> : (
                    <ChatHistory key={"history-" + roomId} conversation={roomId} latest={messages}
                      members={members} userId={user.id} general={shared} visible={!showList}
                      today={today} yesterday={yesterday} unread={unread.get(roomId) ?? 0} />
                    )}
                    <MediaComposer key={roomId} conversation={roomId} canSend={shared || Boolean(partner)} members={shared
                      ? members.filter((member) => member.user_id !== user.id)
                      : partner ? [partner] : []} />
                  </ChatEditing>
                </>
              )}
            </article>}
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
