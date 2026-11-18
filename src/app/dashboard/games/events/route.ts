import { gamesAuth, noStore } from "../server";
import { uuidPattern } from "../catalog";
// Same server-authenticated Postgres Changes bridge as Connect. Safe room metadata only.
export async function GET(request: Request) {
  const room = new URL(request.url).searchParams.get("room");
  if (room && !uuidPattern.test(room)) return new Response(null, { status: 400, headers: noStore });
  const auth = await gamesAuth();
  if (!auth) return new Response(null, { status: 401, headers: noStore });
  const { data } = await auth.client.auth.getSession();
  if (!data.session) return new Response(null, { status: 401, headers: noStore });
  await auth.client.realtime.setAuth(data.session.access_token);
  const encoder = new TextEncoder();
  let stop: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (message: string) => { if (!closed) controller.enqueue(encoder.encode(message)); };
      const channel = auth.client.channel("games-" + auth.user.id + "-" + crypto.randomUUID())
        .on("postgres_changes", { event: "*", schema: "public", table: "game_rooms", ...(room ? { filter: `id=eq.${room}` } : {}) }, () => send("event: refresh\ndata: room\n\n"));
      const timer = setInterval(() => send(": heartbeat\n\n"), 15000);
      const lifetime = setTimeout(() => stop?.(), 50000);
      stop = () => { if (closed) return; closed = true; clearInterval(timer); clearTimeout(lifetime); request.signal.removeEventListener("abort", abort); void auth.client.removeChannel(channel); controller.close(); };
      const abort = () => stop?.();
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) return stop();
      send("retry: 2500\n\n");
      channel.subscribe((status) => { if (status === "SUBSCRIBED") send("event: refresh\ndata: ready\n\n"); if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) stop?.(); });
    },
    cancel() { stop?.(); },
  });
  return new Response(stream, { headers: { ...noStore, "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" } });
}
