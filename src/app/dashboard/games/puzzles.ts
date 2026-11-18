export const puzzles = [
  {
    id: "sudoku-01",
    name: "Morning clarity",
    clues: "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
    solution: "534678912672195348198342567859761423426853791713924856961537284287419635345286179",
  },
  {
    id: "sudoku-02",
    name: "A fresh perspective",
    clues: "003020600900305001001806400008102900700000008006708200002609500800203009005010300",
    solution: "483921657967345821251876493548132976729564138136798245372689514814253769695417382",
  },
  {
    id: "sudoku-03",
    name: "Quiet focus",
    clues: "200080300060070084030500209000105408000000000402706000301007040720040060004010003",
    solution: "245981376169273584837564219976125438513498627482736951391657842728349165654812793",
  },
] as const;

export type GameProgress = { puzzleId: string; entries: string[] };

export function initialProgress(puzzleIndex = 0): GameProgress {
  return { puzzleId: puzzles[puzzleIndex].id, entries: Array<string>(81).fill("") };
}

export function restoreProgress(value: string | null): GameProgress {
  try {
    const saved: unknown = value ? JSON.parse(value) : null;
    if (!saved || typeof saved !== "object" || !("puzzleId" in saved) || !("entries" in saved)) return initialProgress();
    const puzzle = puzzles.find(({ id }) => id === saved.puzzleId);
    if (!puzzle || !Array.isArray(saved.entries) || saved.entries.length !== 81 ||
      !saved.entries.every((entry) => typeof entry === "string" && /^[1-9]?$/.test(entry))) return initialProgress();
    return {
      puzzleId: puzzle.id,
      entries: saved.entries.map((entry: string, index: number) => puzzle.clues[index] === "0" ? entry : ""),
    };
  } catch {
    return initialProgress();
  }
}

export function isSolved(clues: string, entries: string[], solution: string) {
  return entries.length === 81 && entries.every((entry, index) =>
    (clues[index] === "0" ? entry : clues[index]) === solution[index]);
}
