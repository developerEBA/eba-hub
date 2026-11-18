import { requireDashboardAccess } from "../../access";
import { isConversationId } from "../model";

export async function GET(request: Request) {
  const { client, user } = await requireDashboardAccess();
  const room = new URL(request.url).searchParams.get("chat");
  const headers = { "Cache-Control": "private, no-store" };
  if (room !== null) {
    if (!isConversationId(room)) return new Response(null, { status: 404, headers });
    const { data: conversation } = await client.from("connect_conversations")
      .select("id").eq("id", room).maybeSingle();
    if (!conversation) return new Response(null, { status: 404, headers });
  }

  const { data } = await client.auth.getSession();
  if (!data.session) return new Response(null, { status: 401, headers });
  await client.realtime.setAuth(data.session.access_token);

  const encoder = new TextEncoder();
  let stop: ((closeStream?: boolean) => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const notify = (event: string) => {
        if (!closed) controller.enqueue(encoder.encode(event));
      };
      const refresh = () => notify("event: refresh\ndata: changed\n\n");
      const channel = client.channel("connect-" + (room ?? user.id));
      if (room) {
        channel.on("postgres_changes", {
          event: "INSERT", schema: "public", table: "connect_messages", filter: "conversation_id=eq." + room,
        }, refresh);
        channel.on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "connect_messages", filter: "conversation_id=eq." + room,
        }, (payload) => {
          const id = String(payload.new.id);
          if (/^[1-9]\d{0,14}$/.test(id)) notify("event: message-edit\ndata: " + id + "\n\n");
        });
      } else {
        const filter = "recipient_id=eq." + user.id;
        channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "hub_notifications", filter }, refresh);
        channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "hub_notifications", filter }, refresh);
      }

      const heartbeat = setInterval(() => notify(": heartbeat\n\n"), 15000);
      const lifetime = setTimeout(() => stop?.(), 50000);
      const onAbort = () => stop?.();
      stop = (closeStream = true) => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        request.signal.removeEventListener("abort", onAbort);
        void client.removeChannel(channel);
        if (closeStream) controller.close();
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) return stop();

      notify("retry: 2000\n\n");
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") notify("event: refresh\ndata: ready\n\n");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") stop?.();
      });
    },
    cancel() { stop?.(false); },
  });

  return new Response(stream, {
    headers: { ...headers, "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" },
  });
}
