export const gameCatalog = [
  {
    id: "sudoku",
    name: "Sudoku",
    kind: "Solo",
    description: "A quiet challenge. Nine numbers, one satisfying solution.",
    rules:
      "Fill each row, column and 3×3 box with 1–9. Fixed clues cannot change. Your progress stays in this browser for your account.",
  },
  {
    id: "ludo",
    name: "Ludo",
    kind: "Multiplayer",
    description: "Roll, race and bring your four tokens home.",
    rules: [
      "EBA quick Ludo: 2–4 players, four tokens each. A six releases a token onto its start square. ",
      "Move clockwise on a 52-square track, then along a six-square private home lane; exact rolls ",
      "finish at step 57. Rolls come from the server. Six grants another turn, except a third ",
      "consecutive six forfeits that roll. Landing on an opponent on an unsafe square sends it to ",
      "base. All four start squares and the four marked stars are safe. Tokens may share squares; ",
      "there are no blockades. Captures grant no extra turn. First to finish all four tokens wins. ",
      "No legal move passes automatically.",
    ].join(""),
  },
  {
    id: "chess",
    name: "Chess",
    kind: "Multiplayer",
    description: "A thoughtful match. Find your next brilliant move.",
    rules: [
      "Standard chess, White first. Legal moves, check, checkmate, stalemate, castling, en passant ",
      "and promotion are enforced by chess.js. Choose queen, rook, bishop or knight for promotion. ",
      "Threefold repetition, the fifty-move rule and insufficient material end the game as a draw. ",
      "No clocks. Either player may resign; rematches require both players.",
    ].join(""),
  },
  {
    id: "checkers",
    name: "Checkers",
    kind: "Multiplayer",
    description: "Make the jump. Turn a simple move into a strategy.",
    rules: [
      "English draughts / American checkers on an 8×8 board. Red moves first. Men move and capture ",
      "diagonally forward; kings move and capture one diagonal step in either direction. Captures ",
      "are mandatory, but you may choose any capture rather than the longest. Continue jumping ",
      "with the same piece while possible. Reaching the king row ends the turn, even during a ",
      "capture. Win when your opponent has no pieces or no legal move. A draw is automatic after ",
      "80 consecutive plies without a capture or promotion (EBA draw rule).",
    ].join(""),
  },
  {
    id: "tic-tac-toe",
    name: "Tic-Tac-Toe",
    kind: "Multiplayer",
    description: "Three in a row. A quick friendly rivalry.",
    rules:
      "X goes first. Players alternate placing a mark in an empty square. Three in a row, column or diagonal wins. A full board without a line is a draw. Both players must request a rematch; first player alternates each round.",
  },
  {
    id: "trivia",
    name: "EBA Trivia",
    kind: "Multiplayer",
    description: "Bring your curiosity. Play a hosted knowledge quiz.",
    rules:
      "2–4 players including the host. The host starts each of eight general-knowledge questions. Each question lasts 20 seconds. One answer per player; answers cannot be changed. The server awards 100 points for a correct answer, with no speed bonus. Correct answers and all responses stay private until the timer expires. Any participant may close an expired question; the host opens the next. Highest score wins, ties are shared. This is a social quiz, never an employee assessment.",
  },
] as const;
export type GameId = (typeof gameCatalog)[number]["id"];
export type MultiplayerGame = Exclude<GameId, "sudoku">;
export function isMultiplayerGame(value: unknown): value is MultiplayerGame {
  return (
    typeof value === "string" &&
    gameCatalog.some((game) => game.id === value && game.id !== "sudoku")
  );
}
export const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export type GameRoom = {
  id: string;
  game: MultiplayerGame;
  host_id: string;
  capacity: number;
  status: "waiting" | "active" | "finished";
  version: number;
  round: number;
  result: GameResult | null;
  visibility: "open" | "invite";
  session_id: string | null;
  created_at: string;
};
export type Player = {
  user_id: string;
  display_name: string;
  seat: number;
  last_seen: string;
  left_at: string | null;
};
export type GameResult = {
  message: string;
  winner?: number;
  winners?: number[];
  scores?: number[];
  names?: string[];
  participants?: { userId: string; seat: number }[];
};
export type GameNight = {
  id: string;
  title: string;
  starts_at: string;
  games: GameId[];
  created_by: string;
  status: "scheduled" | "completed" | "cancelled";
};
export type Move = {
  type: string;
  from?: number;
  to?: number;
  token?: number;
  answer?: number;
  promotion?: string;
};
export type MatchState = {
  turn: number;
  first: number;
  board: number[];
  tokens: number[][];
  dice: number | null;
  sixes: number;
  forced: number | null;
  quiet: number;
  moves: string[];
  fen: string;
  phase: "question" | "revealed";
  question: number;
  deadline: number;
  answers: Record<string, number>;
  scores: number[];
  rematch: number[];
  result: GameResult | null;
};
export type RoomView = {
  room: GameRoom;
  players: Player[];
  state: MatchState | null;
  self: string;
  question?: { text: string; options: readonly string[]; correct?: number; answered: boolean };
  history: { round: number; result: GameResult }[];
  legal?: { from: number; to: number; promotion?: string }[];
  check?: boolean;
  serverTime: number;
};
