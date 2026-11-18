import type { CSSProperties } from "react";

const chessColumns = { k: 0, q: 1, b: 2, n: 3, r: 4, p: 5 } as const;
export const chessNames: Record<string, string> = { k: "king", q: "queen", b: "bishop", n: "knight", r: "rook", p: "pawn" };

export function PieceSprite({ column, row, className = "" }: { column: number; row: number; className?: string }) {
  return <span aria-hidden="true" className={`hd-piece ${className}`} style={{ "--piece-x": `${column * 20}%`, "--piece-y": `${row * 100 / 3}%` } as CSSProperties}/>;
}

export function ChessPiece({ piece }: { piece: string }) {
  const column = chessColumns[piece.toLowerCase() as keyof typeof chessColumns];
  if (column === undefined) return null;
  return <PieceSprite column={column} row={piece === piece.toUpperCase() ? 0 : 1} className="hd-piece--chess"/>;
}

export function CheckerPiece({ piece }: { piece: number }) {
  // Seat 0 is red/coral in the rules; seat 1 is the dark emerald set.
  return <PieceSprite column={Math.abs(piece) === 2 ? piece > 0 ? 1 : 0 : piece > 0 ? 5 : 4} row={Math.abs(piece) === 2 ? 3 : 2} className="hd-piece--checker"/>;
}

export function LudoPiece({ seat }: { seat: number }) {
  return <PieceSprite column={seat} row={2} className="hd-piece--ludo"/>;
}
