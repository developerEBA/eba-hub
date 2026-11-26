import { requireHodDashboardAccess } from "../../access";
import { loadChatHistory, messageFields } from "../history-data";
import { isConversationId, type ConnectMessage } from "../model";

export async function GET(request: Request) {
  const { client } = await requireHodDashboardAccess();
  const params = new URL(request.url).searchParams;
  const room = params.get("chat");
  const cursor = params.get("before") ?? "";
  const message = params.get("message");
  const headers = { "Cache-Control": "private, no-store" };
  if (!isConversationId(room) || !/^[1-9]\d{0,14}$/.test(message ?? cursor)) {
    return new Response(null, { status: 400, headers });
  }

  const { data: conversation } = await client.from("connect_conversations")
    .select("id").eq("id", room).maybeSingle();
  if (!conversation) return new Response(null, { status: 404, headers });

  if (message) {
    const { data } = await client.from("connect_messages").select(messageFields)
      .eq("conversation_id", room).eq("id", message).maybeSingle<ConnectMessage>();
    return data ? Response.json(data, { headers }) : new Response(null, { status: 404, headers });
  }

  const result = await loadChatHistory(client, room, Number(cursor));
  if (result.error) return new Response(null, { status: 503, headers });
  return Response.json({ messages: result.messages, hasOlder: result.hasOlder }, { headers });
}
