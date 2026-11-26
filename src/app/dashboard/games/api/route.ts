import { gameCatalog, isMultiplayerGame, uuidPattern } from "../catalog";
import { chessAvailable } from "../chess-server";
import { gamesAdmin, gamesAuth, loadLounge, noStore, readPayload } from "../server";

export async function GET() {
  const auth = await gamesAuth();
  if (!auth) return Response.json({ error: "Sign in with an active Hub account." }, { status: 401, headers: noStore });
  return Response.json(await loadLounge(auth.client,auth.role,auth.departments), { headers: noStore });
}
export async function POST(request: Request) {
  const auth = await gamesAuth();
  if (!auth) return Response.json({ error: "Sign in with an active Hub account." }, { status: 401, headers: noStore });
  const admin = gamesAdmin();
  if (!admin) return Response.json({ error: "Multiplayer server configuration is pending." }, { status: 503, headers: noStore });
  try {
    const body = await readPayload(request);
    if (typeof body.requestId !== "string" || !uuidPattern.test(body.requestId)) throw new Error("Invalid request ID.");
    if (body.command === "schedule") {
      if (auth.role !== "Admin") return Response.json({ error: "Only an Admin can schedule Game Night." }, { status: 403 });
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const games = body.games;
      const time = typeof body.startsAt === "string" ? Date.parse(body.startsAt) : NaN;
      if (!title || title.length > 100 || !Number.isFinite(time) || time < Date.now() || time > Date.now() + 366 * 86400000 || !Array.isArray(games) || games.length < 1 || games.length > 6 || new Set(games).size !== games.length || !games.every((id) => gameCatalog.some((g) => g.id === id))) throw new Error("Enter a future date, title and at least one supported game.");
      const { error } = await admin.from("game_nights").insert({ id: body.requestId, title, starts_at: new Date(time).toISOString(), games, created_by: auth.user.id });
      if (error) {
        const { data: existing } = await admin.from("game_nights").select("id").eq("id", body.requestId).eq("created_by", auth.user.id).maybeSingle();
        if (!existing) throw new Error("Session could not be scheduled. Check the migration.");
      }
      return Response.json({ session: body.requestId }, { headers: noStore });
    }
    if (body.command === "session-status") {
      if (auth.role !== "Admin" || typeof body.session !== "string" || !uuidPattern.test(body.session) || !["completed", "cancelled"].includes(String(body.status))) throw new Error("Admin session action required.");
      const { error } = await admin.from("game_nights").update({ status: body.status }).eq("id", body.session);
      if (error) throw new Error("Session could not be updated.");
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (body.command !== "create" || !isMultiplayerGame(body.game)) throw new Error("Choose a multiplayer game.");
    if (body.game === "chess" && !chessAvailable()) throw new Error("Install chess.js@1.4.0 on the server first.");
    const capacity = body.game === "ludo" || body.game === "trivia" ? body.capacity : 2;
    if (!Number.isInteger(capacity) || Number(capacity) < 2 || Number(capacity) > 4 || !["open", "invite"].includes(String(body.visibility))) throw new Error("Choose 2–4 seats and a room visibility.");
    if (body.session !== null && body.session !== undefined && (typeof body.session !== "string" || !uuidPattern.test(body.session))) throw new Error("Invalid session.");
    const { data, error } = await admin.rpc("games_lobby_command", { p_actor: auth.user.id, p_room: null, p_request: body.requestId, p_command: "create", p_payload: { game: body.game, capacity, visibility: body.visibility, session: body.session ?? null } });
    if (error) throw new Error("Room could not be created. Check session availability and room limits.");
    return Response.json({ room: data }, { headers: noStore });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 400, headers: noStore }); }
}
