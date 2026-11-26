import { gamesAuth, noStore } from "../../server";
import { summarizeRecord } from "../../record";
import type { GameResult } from "../../catalog";

export async function GET() {
  const auth = await gamesAuth();
  if (!auth) return Response.json({ error: "Sign in to see your record." }, { status: 401, headers: noStore });
  const players = await auth.client.from("game_players").select("room_id,seat,display_name,left_at").eq("user_id", auth.user.id).order("last_seen", { ascending: false }).limit(1000);
  if (players.error) return Response.json({ error: "Your record could not be loaded." }, { status: 503, headers: noStore });
  if (!players.data.length) return Response.json(summarizeRecord(auth.user.id, [], []), { headers: noStore });

  const batches = [];
  for (let offset = 0; offset < players.data.length; offset += 100) batches.push(players.data.slice(offset, offset + 100).map((player) => player.room_id));
  const responses = await Promise.all(batches.map((ids) => auth.client.from("game_results").select("room_id,round,result,completed_at").in("room_id", ids).order("completed_at", { ascending: false }).limit(200)));
  if (responses.some((response) => response.error)) return Response.json({ error: "Your record could not be loaded." }, { status: 503, headers: noStore });
  const rounds = responses.flatMap((response) => response.data ?? []).sort((a,b) => b.completed_at.localeCompare(a.completed_at)).slice(0,200);
  return Response.json(summarizeRecord(auth.user.id, rounds as { room_id: string; round: number; result: GameResult; completed_at: string }[], players.data), { headers: noStore });
}
