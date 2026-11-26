import "server-only";
import { Chess } from "chess.js";
import type { MatchState, Move } from "./catalog";
import { requireRule } from "./rules";



export function chessAvailable() { return typeof Chess === "function"; }
function engine(state: MatchState) { const chess = new Chess(); if (state.moves.length) chess.loadPgn(state.moves[0]); return chess; }
const square = (index: number) => "abcdefgh"[index % 8] + (8 - Math.floor(index / 8));
const index = (square: string) => (8 - Number(square[1])) * 8 + "abcdefgh".indexOf(square[0]);
export function chessLegal(state: MatchState) { return engine(state).moves({ verbose: true }).map((move) => ({ from: index(move.from), to: index(move.to), promotion: move.promotion })); }
export function chessMove(original: MatchState, seat: number, firstSeat: number, move: Move) {
  requireRule(!original.result, "This match has finished.");
  const state = structuredClone(original);
  if (move.type === "resign") { state.result = { winner: 1 - seat, message: "Player resigned." }; return state; }
  requireRule(original.turn === seat, "Wait for your turn.");
  requireRule(move.type === "move" && Number.isInteger(move.from) && Number.isInteger(move.to) && move.from! >= 0 && move.from! < 64 && move.to! >= 0 && move.to! < 64 && (!move.promotion || ["q", "r", "b", "n"].includes(move.promotion)), "Invalid chess move.");
  const chess = engine(state);
  try { chess.move({ from: square(move.from!), to: square(move.to!), promotion: move.promotion ?? "q" }); } catch { throw new Error("That move is not legal."); }
  state.moves = [chess.pgn()]; state.fen = chess.fen(); state.turn = chess.turn() === "w" ? firstSeat : 1 - firstSeat;
  if (chess.isCheckmate()) state.result = { winner: seat, message: "Checkmate." };
  else if (chess.isStalemate()) state.result = { message: "Draw by stalemate." };
  else if (chess.isDraw()) state.result = { message: "Draw by repetition, fifty-move rule or insufficient material." };
  return state;
}
export function chessCheck(state: MatchState) { return engine(state).isCheck(); }
