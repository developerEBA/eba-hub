import { requireHodDashboardAccess } from "../../access";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  try {
    const { client, user } = await requireHodDashboardAccess();
    const result = await client
      .from("hub_notifications")
      .select(
        "id,created_at,read_at,conversation_id,approval_id,calendar_occurrence_id,game_room_id",
      )
      .eq("recipient_id", user.id)
      .order("id", { ascending: false })
      .limit(25);
    if (result.error)
      return Response.json({ error: "Reminders unavailable." }, { status: 503, headers });
    return Response.json({ items: result.data ?? [] }, { headers });
  } catch {
    return Response.json({ error: "Sign in again." }, { status: 401, headers });
  }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Request origin rejected." }, { status: 403, headers });
  try {
    const { client, user } = await requireHodDashboardAccess();
    const raw = (await request.json()) as { id?: unknown };
    let query = client
      .from("hub_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", user.id)
      .is("read_at", null);
    if (raw.id !== -1) {
      if (!Number.isSafeInteger(raw.id) || Number(raw.id) < 1)
        return Response.json({ error: "Reminder unavailable." }, { status: 400, headers });
      query = query.eq("id", raw.id as number);
    }
    const result = await query;
    if (result.error)
      return Response.json(
        { error: "Reminder could not be marked read." },
        { status: 503, headers },
      );
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: "Sign in again." }, { status: 401, headers });
  }
}
