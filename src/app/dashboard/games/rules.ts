import type { GameResult, MatchState, Move, MultiplayerGame } from "./catalog";

export function freshState(game: MultiplayerGame, count: number, first = 0): MatchState {
  const board = Array<number>(game === "tic-tac-toe" ? 9 : 64).fill(0);
  if (game === "checkers") for (let i = 0; i < 64; i++) if ((Math.floor(i / 8) + i % 8) % 2) board[i] = i < 24 ? 1 : i > 39 ? -1 : 0;
  return { turn: first, first, board, tokens: Array.from({ length: count }, () => [-1, -1, -1, -1]), dice: null, sixes: 0, forced: null, quiet: 0, moves: [], fen: "", phase: "revealed", question: -1, deadline: 0, answers: {}, scores: Array<number>(count).fill(0), rematch: [], result: null };
}
export function requireRule(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export const ludoSafe = [0, 8, 13, 21, 26, 34, 39, 47];
export function ludoSquare(seat: number, progress: number) { return (seat * 13 + progress) % 52; }
export function ludoMoves(state: MatchState, seat: number) { return state.tokens[seat].flatMap((p, token) => state.dice !== null && ((p === -1 && state.dice === 6) || (p >= 0 && p < 57 && p + state.dice <= 57)) ? [token] : []); }

export function checkersMoves(state: MatchState, seat = state.turn) {
  const side = seat === 0 ? 1 : -1;
  const captures: { from: number; to: number; captured?: number }[] = [], normal: typeof captures = [];
  for (let from = 0; from < 64; from++) {
    const piece = state.board[from];
    if (Math.sign(piece) !== side || (state.forced !== null && state.forced !== from)) continue;
    const row = Math.floor(from / 8), col = from % 8;
    for (const dr of Math.abs(piece) === 2 ? [-1, 1] : [side]) for (const dc of [-1, 1]) {
      const r = row + dr, c = col + dc;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      const next = r * 8 + c;
      if (!state.board[next] && state.forced === null) normal.push({ from, to: next });
      const rr = row + dr * 2, cc = col + dc * 2;
      if (Math.sign(state.board[next]) === -side && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && !state.board[rr * 8 + cc]) captures.push({ from, to: rr * 8 + cc, captured: next });
    }
  }
  return captures.length ? captures : state.forced !== null ? [] : normal;
}

export function applyBoardMove(game: MultiplayerGame, original: MatchState, seat: number, count: number, move: Move, roll?: number): MatchState {
  const state = structuredClone(original);
  requireRule(!state.result, "This match has finished.");
  if (move.type === "resign") { state.result = count === 2 ? { winner: 1 - seat, message: "Player resigned." } : { message: "Match ended by resignation." }; return state; }
  requireRule(state.turn === seat, "Wait for your turn.");
  if (game === "tic-tac-toe") {
    requireRule(move.type === "place" && Number.isInteger(move.to) && move.to! >= 0 && move.to! < 9 && state.board[move.to!] === 0, "Choose an empty square.");
    const mark = seat === state.first ? 1 : 2;
    state.board[move.to!] = mark;
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    if (lines.some((line) => line.every((i) => state.board[i] === mark))) state.result = { winner: seat, message: "Three in a row!" };
    else if (state.board.every(Boolean)) state.result = { message: "Draw. A well-matched pair." };
    state.turn = 1 - seat;
  } else if (game === "checkers") {
    const legal = checkersMoves(state).find((entry) => entry.from === move.from && entry.to === move.to);
    requireRule(move.type === "move" && legal, "Choose a legal move. Captures are compulsory.");
    const piece = state.board[legal.from]; state.board[legal.from] = 0; state.board[legal.to] = piece;
    if (legal.captured !== undefined) state.board[legal.captured] = 0;
    const promoted = Math.abs(piece) === 1 && (piece > 0 ? legal.to >= 56 : legal.to < 8);
    if (promoted) state.board[legal.to] = piece * 2;
    state.quiet = legal.captured !== undefined || promoted ? 0 : state.quiet + 1;
    state.forced = legal.captured !== undefined && !promoted ? legal.to : null;
    if (state.forced !== null && checkersMoves(state).length) return state;
    state.forced = null; state.turn = 1 - seat;
    if (!checkersMoves(state).length) state.result = { winner: seat, message: "Opponent has no legal moves." };
    else if (state.quiet >= 80) state.result = { message: "Draw after 80 quiet plies." };
  } else if (game === "ludo") {
    if (move.type === "roll") {
      requireRule(state.dice === null && roll !== undefined && Number.isInteger(roll) && roll >= 1 && roll <= 6, "Cannot roll now.");
      state.dice = roll; state.sixes = roll === 6 ? state.sixes + 1 : 0;
      if (state.sixes === 3) { state.dice = null; state.sixes = 0; state.turn = (seat + 1) % count; return state; }
      if (!ludoMoves(state, seat).length) { state.dice = null; if (roll !== 6) { state.turn = (seat + 1) % count; state.sixes = 0; } }
      return state;
    }
    requireRule(move.type === "token" && ludoMoves(state, seat).includes(move.token!), "Roll first, then choose a legal token.");
    const token = move.token!, die = state.dice!;
    state.tokens[seat][token] = state.tokens[seat][token] === -1 ? 0 : state.tokens[seat][token] + die;
    const progress = state.tokens[seat][token], square = ludoSquare(seat, progress);
    if (progress <= 51 && !ludoSafe.includes(square)) state.tokens.forEach((tokens, other) => {
      if (other !== seat) tokens.forEach((p, index) => { if (p >= 0 && p <= 51 && ludoSquare(other, p) === square) tokens[index] = -1; });
    });
    if (state.tokens[seat].every((p) => p === 57)) state.result = { winner: seat, message: "All four tokens are home!" };
    state.dice = null;
    if (die !== 6) { state.turn = (seat + 1) % count; state.sixes = 0; }
  } else throw new Error("Unsupported board game.");
  return state;
}

export function resultText(result: GameResult, names: string[]) { return result.winner !== undefined ? `${(result.names ?? names)[result.winner] ?? "Player"} wins. ${result.message}` : result.message; }
