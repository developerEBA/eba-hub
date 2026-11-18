import type { MatchState, Move } from "./catalog";
import { requireRule } from "./rules";

export function applyTrivia(original: MatchState, seat: number, hostSeat: number, move: Move, now: number, correctAnswers: readonly number[]) {
  const state = structuredClone(original);
  requireRule(!state.result, "The quiz has finished.");
  if (move.type === "next") {
    requireRule(seat === hostSeat && state.phase === "revealed" && state.question < correctAnswers.length - 1, "Only the host can open the next question.");
    state.question++; state.deadline = now + 20000; state.phase = "question"; state.answers = {};
  } else if (move.type === "answer") {
    requireRule(state.phase === "question" && now < state.deadline && Number.isInteger(move.answer) && move.answer! >= 0 && move.answer! <= 3 && state.answers[String(seat)] === undefined, "The question is closed or you already answered.");
    state.answers[String(seat)] = move.answer!;
  } else if (move.type === "close") {
    requireRule(state.phase === "question" && now >= state.deadline, "The question is still open.");
    state.phase = "revealed";
    state.scores = state.scores.map((score, index) => score + (state.answers[String(index)] === correctAnswers[state.question] ? 100 : 0));
    if (state.question === correctAnswers.length - 1) {
      const best = Math.max(...state.scores), winners = state.scores.flatMap((score, index) => score === best ? [index] : []);
      state.result = { message: winners.length === 1 ? "Quiz complete." : "Quiz complete — shared first place.", winners, ...(winners.length === 1 ? { winner: winners[0] } : {}), scores: state.scores };
    }
  } else throw new Error("Unsupported quiz action.");
  return state;
}
