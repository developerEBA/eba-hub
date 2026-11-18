import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createStaffClient, getStaffRole } from "../../../lib/staff-auth";
import type { GameNight, GameRoom, MatchState, Player, RoomView } from "./catalog";
import { chessAvailable, chessCheck, chessLegal } from "./chess-server";
import { triviaQuestions } from "./trivia-bank";
import { checkersMoves } from "./rules";

export function gamesAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
export async function gamesAuth() {
  const client = await createStaffClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const role = await getStaffRole(client, data.user);
  return role ? { client, user: data.user, role } : null;
}
export async function loadLounge(client: NonNullable<Awaited<ReturnType<typeof createStaffClient>>>) {
  const [rooms, sessions, members, invites] = await Promise.all([
    client.from("game_rooms").select("*").order("created_at", { ascending: false }).limit(60),
    client.from("game_nights").select("*").eq("status", "scheduled").gte("starts_at", new Date(Date.now() - 12 * 3600000).toISOString()).order("starts_at").limit(20),
    loadGameMembers(),
    client.from("game_invites").select("room_id,game_rooms!inner(*)").eq("game_rooms.status", "waiting").limit(50),
  ]);
  const invitations = (invites.data ?? []).flatMap((invite) => invite.game_rooms ? Array.isArray(invite.game_rooms) ? invite.game_rooms : [invite.game_rooms] : []) as GameRoom[];
  const roomIds = [...new Set([...(rooms.data ?? []).map((room) => room.id), ...invitations.map((room) => room.id)])];
  const players = roomIds.length ? await client.from("game_players").select("room_id,user_id,seat,display_name,last_seen,left_at").in("room_id", roomIds).is("left_at", null).limit(440) : { data: [], error: null };
  const admin = gamesAdmin();
  const error = Boolean(rooms.error || players.error || sessions.error);
  return { rooms: (rooms.data ?? []) as GameRoom[], players: (players.data ?? []) as (Player & { room_id: string })[], sessions: (sessions.data ?? []) as GameNight[], members, invitations: invitations.filter((room) => room.status === "waiting"), invitesError: Boolean(invites.error), ready: !error && Boolean(admin), chessReady: chessAvailable(), error: error || !admin ? "Multiplayer is not available yet. Please contact your Hub administrator." : null };
}

// Call only after the staff gate. Room entry needs invitees, not the entire lobby.
export async function loadGameMembers() {
  const admin = gamesAdmin();
  let members: { user_id: string; display_name: string }[] = [];
  if (admin) {
    const { data: memberships } = await admin.from("staff_memberships").select("user_id,role").eq("status", "active").in("role", ["ceo", "admin"]).limit(100);
    if (memberships?.length) {
      const { data: profiles } = await admin.from("connect_profiles").select("user_id,display_name").in("user_id", memberships.map((member) => member.user_id));
      members = memberships.map((member) => ({ user_id: member.user_id, display_name: profiles?.find((profile) => profile.user_id === member.user_id)?.display_name ?? `${member.role.toUpperCase()} · ${member.user_id.slice(0, 6)}` }));
    }
  }
  return members;
}
export async function nextGameNight(client: NonNullable<Awaited<ReturnType<typeof createStaffClient>>>) {
  const { data, error } = await client.from("game_nights").select("*").eq("status", "scheduled")
    .gte("starts_at", new Date(Date.now() - 12 * 3600000).toISOString()).order("starts_at").limit(1).maybeSingle();
  return { night: data as GameNight | null, error: Boolean(error) };
}
export const nightDate = (value: string) => new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export async function readMatch(admin: NonNullable<ReturnType<typeof gamesAdmin>>, room: GameRoom) {
  const [players, state, history] = await Promise.all([
    admin.from("game_players").select("user_id,seat,display_name,last_seen,left_at").eq("room_id", room.id).is("left_at", null).order("seat"),
    admin.from("game_states").select("state").eq("room_id", room.id).maybeSingle(),
    admin.from("game_results").select("round,result").eq("room_id", room.id).order("round", { ascending: false }).limit(10),
  ]);
  if (players.error || state.error || history.error) throw new Error("Room could not be loaded.");
  return { players: players.data as Player[], state: state.data?.state as MatchState | null, history: history.data ?? [] };
}
export function publicMatch(room: GameRoom, match: Awaited<ReturnType<typeof readMatch>>, self: string): RoomView {
  const seat = match.players.find((player) => player.user_id === self)?.seat;
  const state = seat !== undefined && match.state ? structuredClone(match.state) : null;
  const view: RoomView = { room, players: match.players, state, self, history: match.history, serverTime: Date.now() };
  if (state && room.result) state.result = room.result;
  if (state && room.game === "trivia") {
    const question = triviaQuestions[state.question];
    if (question) view.question = { text: question.text, options: question.options, ...(state.phase === "revealed" ? { correct: question.correct } : {}), answered: state.answers[String(seat)] !== undefined };
    if (state.phase === "question") state.answers = {};
  }
  if (state && room.game === "checkers" && room.status === "active") view.legal = checkersMoves(state);
  if (state && room.game === "chess" && room.status === "active" && chessAvailable()) {
    view.legal = chessLegal(state);
    view.check = chessCheck(state);
  }
  return view;
}

export async function readPayload(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new Error("Request origin rejected.");
  if (Number(request.headers.get("content-length")) > 8000) throw new Error("Request too large.");
  const text = await request.text();
  if (text.length > 8000) throw new Error("Request too large.");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request.");
  return value as Record<string, unknown>;
}
export const noStore = { "Cache-Control": "private, no-store" };
