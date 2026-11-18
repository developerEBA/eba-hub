import type { GameResult } from "./catalog";

export type RoundOutcome = "win" | "loss" | "draw";
export type PersonalRecord = { wins: number; losses: number; draws: number; played: number; streak: number; streakKind: RoundOutcome | null; bestWinStreak: number; recent: RoundOutcome[] };
type Participation = { room_id: string; seat: number; display_name: string; left_at: string | null };
type CompletedRound = { room_id: string; round: number; completed_at: string; result: GameResult };

export function summarizeRecord(userId: string, rounds: CompletedRound[], participation: Participation[]): PersonalRecord {
  const membership = new Map(participation.map((player) => [player.room_id, player]));
  const outcomes: RoundOutcome[] = [];
  const seen = new Set<string>();
  for (const round of [...rounds].sort((a, b) => b.completed_at.localeCompare(a.completed_at) || b.round - a.round)) {
    const key = `${round.room_id}:${round.round}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = round.result;
    const player = membership.get(round.room_id);
    // New results preserve identities even if a seat is later reused. Older
    // results count only when the still-seated player's saved name matches.
    const seat = result.participants
      ? result.participants.find((member) => member.userId === userId)?.seat
      : player && !player.left_at && result.names?.[player.seat] === player.display_name ? player.seat : undefined;
    if (seat === undefined) continue;
    const winners = result.winners ?? (result.winner !== undefined ? [result.winner] : []);
    outcomes.push(winners.length === 0 ? "draw" : winners.length > 1 && winners.includes(seat) ? "draw" : winners.includes(seat) ? "win" : "loss");
  }
  const streakKind = outcomes[0] ?? null;
  let streak = 0, bestWinStreak = 0, run = 0;
  for (const outcome of outcomes) {
    if (outcome === "win") bestWinStreak = Math.max(bestWinStreak, ++run);
    else run = 0;
  }
  for (const outcome of outcomes) { if (outcome !== streakKind) break; streak++; }
  return { wins: outcomes.filter((value) => value === "win").length, losses: outcomes.filter((value) => value === "loss").length, draws: outcomes.filter((value) => value === "draw").length, played: outcomes.length, streak, streakKind, bestWinStreak, recent: outcomes.slice(0, 8) };
}
