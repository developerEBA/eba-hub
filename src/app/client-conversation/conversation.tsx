import Link from "next/link";
import type { requireDashboardAccess } from "../dashboard/access";
import { ClientMessageReadReceipt, ClientMessageRefresh, ConversationComposer } from "./composer";
import "./conversation.css";

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

export async function ClientConversation({ client, clientId, side, baseUrl, before, canSend }: {
  client: Awaited<ReturnType<typeof requireDashboardAccess>>["client"];
  clientId: string;
  side: "staff" | "client";
  baseUrl: string;
  before?: string | string[];
  canSend: boolean;
}) {
  const cursor = typeof before === "string" && /^[1-9]\d{0,14}$/.test(before) ? before : null;
  const query = client.from("client_conversation_messages").select("id,sender_side,body,created_at,client_message_reads(message_id)")
    .eq("client_id", clientId).order("id", { ascending: false }).limit(51);
  const { data, error } = await (cursor ? query.lt("id", cursor) : query);
  const messages = (data ?? []).slice(0, 50).reverse();
  const oldest = messages[0];
  const unread = messages.filter((message) => message.sender_side !== side && !message.client_message_reads.length);

  return <section className="eba-client-chat" aria-label="Private client conversation">
    <p>Private conversation between the client and authorized EBA staff.</p>
    {side === "staff" && <ClientMessageRefresh />}
    {unread.length > 0 && <ClientMessageReadReceipt side={side} clientId={clientId} messageIds={unread.map(({ id }) => id).join(",")} />}
    {cursor && <Link href={baseUrl}>Back to latest messages</Link>}
    {error ? <p role="status">Messages could not be loaded.</p> : <>
      {oldest && (data?.length ?? 0) > 50 && <Link href={baseUrl + (baseUrl.includes("?") ? "&" : "?") + "before=" + oldest.id}>Older messages</Link>}
      {messages.length ? <ol className="eba-client-chat__messages">
        {messages.map((message) => <li key={message.id} data-own={message.sender_side === side}>
          <div>
            <strong>{message.sender_side === "staff" ? "EBA team" : "Client"}</strong>
            <time dateTime={message.created_at}>{dateTime.format(new Date(message.created_at))}</time>
            {message.sender_side !== side && !message.client_message_reads.length && <span className="eba-client-chat__unread">Unread</span>}
          </div>
          <p>{message.body}</p>
        </li>)}
      </ol> : <p className="eba-client-chat__empty">No messages yet.</p>}
    </>}
    {!cursor && canSend && !error && <ConversationComposer key={clientId} side={side} clientId={clientId} />}
    {!canSend && <p>This conversation is read-only for your role.</p>}
  </section>;
}
