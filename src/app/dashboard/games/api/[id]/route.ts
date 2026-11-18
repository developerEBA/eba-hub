import { randomInt } from "node:crypto";
import { uuidPattern, type GameRoom, type Move } from "../../catalog";
import { chessAvailable, chessMove } from "../../chess-server";
import { applyBoardMove, freshState, requireRule } from "../../rules";
import { applyTrivia } from "../../trivia-rules";
import { triviaQuestions } from "../../trivia-bank";
import { gamesAdmin, gamesAuth, noStore, publicMatch, readMatch, readPayload } from "../../server";

type Context = { params: Promise<{ id: string }> };
async function access(id: string) {
  const auth = await gamesAuth(), admin = gamesAdmin();
  if (!auth) return { response: Response.json({ error: "Sign in again." }, { status: 401, headers: noStore }) };
  if (!admin) return { response: Response.json({ error: "Multiplayer server is not configured." }, { status: 503, headers: noStore }) };
  if (!uuidPattern.test(id)) return { response: Response.json({ error: "Room unavailable." }, { status: 404 }) };
  const { data } = await auth.client.from("game_rooms").select("*").eq("id", id).maybeSingle();
  if (!data) return { response: Response.json({ error: "Room unavailable or invitation required." }, { status: 404, headers: noStore }) };
  return { auth, admin, room: data as GameRoom };
}
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params, found = await access(id);
  if (found.response) return found.response;
  try {
    const match = await readMatch(found.admin, found.room);
    const { data: latest } = await found.auth.client.from("game_rooms").select("version").eq("id", id).single();
    if (!latest || latest.version !== found.room.version) return Response.json({ error: "Room changed. Refreshing…" }, { status: 409, headers: noStore });
    return Response.json(publicMatch(found.room, match, found.auth.user.id), { headers: noStore });
  } catch { return Response.json({ error: "Room could not be loaded." }, { status: 503, headers: noStore }); }
}
export async function POST(request: Request, context: Context) {
  const { id } = await context.params, found = await access(id);
  if (found.response) return found.response;
  const { auth, admin, room } = found;
  try {
    const body = await readPayload(request);
    requireRule(typeof body.requestId === "string" && uuidPattern.test(body.requestId), "Invalid request ID.");
    const { data: duplicate, error: duplicateError } = await admin.from("game_requests").select("room_id").eq("actor_id", auth.user.id).eq("request_id", body.requestId).maybeSingle();
    requireRule(!duplicateError, "Move log unavailable.");
    if (duplicate) { requireRule(duplicate.room_id === id, "Request ID already used."); return Response.json({ ok: true }, { headers: noStore }); }
    if (["join", "leave", "invite"].includes(String(body.command))) {
      requireRule(body.command !== "invite" || (typeof body.user === "string" && uuidPattern.test(body.user)), "Enter the invited member’s user ID.");
      const { error } = await admin.rpc("games_lobby_command", { p_actor: auth.user.id, p_room: id, p_request: body.requestId, p_command: body.command, p_payload: { user: body.user } });
      requireRule(!error, body.command === "join" ? "Room is full, started, or invitation is required." : "Room action could not be completed.");
      return Response.json({ ok: true }, { headers: noStore });
    }
    const match = await readMatch(admin, room), me = match.players.find((player) => player.user_id === auth.user.id);
    requireRule(me, "Join the room first.");
    if (body.command === "presence") {
      const { error } = await admin.from("game_players").update({ last_seen: new Date().toISOString() }).eq("room_id", id).eq("user_id", auth.user.id).is("left_at", null);
      requireRule(!error, "Presence could not be updated.");
      return Response.json({ ok: true }, { headers: noStore });
    }
    requireRule(Number.isInteger(body.version) && body.version === room.version, "The room changed. Refresh before moving.");
    let state = match.state, round = room.round;
    if (body.command === "start") {
      requireRule(room.status === "waiting" && room.host_id === auth.user.id && match.players.length >= 2, "Only the host can start with at least two players.");
      requireRule(room.game !== "chess" || chessAvailable(), "Install chess.js@1.4.0 first.");
      state = freshState(room.game, match.players.length);
      if (room.game === "trivia") state = applyTrivia(state, me.seat, me.seat, { type: "next" }, Date.now(), triviaQuestions.map((q) => q.correct));
    } else if (body.command === "rematch") {
      requireRule(room.status === "finished" && match.players.length >= 2, "A rematch needs at least two remaining players.");
      state = state ?? freshState(room.game, match.players.length);
      state.result = room.result ?? state.result;
      if (!state.rematch.includes(me.seat)) state.rematch.push(me.seat);
      if (match.players.every((player) => state!.rematch.includes(player.seat))) {
        requireRule(match.players.every((player, index) => player.seat === index), "Seats changed. Create a new room.");
        round++; state = freshState(room.game, match.players.length, ["chess", "tic-tac-toe"].includes(room.game) ? (round - 1) % 2 : 0);
        if (room.game === "trivia") state = applyTrivia(state, me.seat, me.seat, { type: "next" }, Date.now(), triviaQuestions.map((q) => q.correct));
      }
    } else {
      requireRule(body.command === "move" && room.status === "active" && state && body.move && typeof body.move === "object" && !Array.isArray(body.move), "No active match.");
      const move = body.move as Move;
      if (room.game === "chess") state = chessMove(state, me.seat, (round - 1) % 2, move);
      else if (room.game === "trivia") {
        const host = match.players.find((player) => player.user_id === room.host_id)!;
        state = applyTrivia(state, me.seat, host.seat, move, Date.now(), triviaQuestions.map((q) => q.correct));
      } else state = applyBoardMove(room.game, state, me.seat, match.players.length, move, move.type === "roll" ? randomInt(1, 7) : undefined);
    }
    if (state?.result && !state.result.names) state.result.names = match.players.map((player) => player.display_name);
    if (state?.result && !state.result.participants) state.result.participants = match.players.map((player) => ({ userId: player.user_id, seat: player.seat }));
    const { data, error } = await admin.rpc("games_commit", { p_actor: auth.user.id, p_room: id, p_request: body.requestId, p_version: room.version, p_state: state, p_status: state?.result ? "finished" : "active", p_round: round });
    if (error || data !== true) return Response.json({ error: "Another action arrived first. Refresh and try again." }, { status: 409, headers: noStore });
    const committedRoom = { ...room, version: room.version + 1, round, status: state?.result ? "finished" as const : "active" as const, result: state?.result ?? null };
    return Response.json({ ok: true, view: publicMatch(committedRoom, { ...match, state }, auth.user.id) }, { headers: noStore });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Action failed." }, { status: 400, headers: noStore }); }
}
