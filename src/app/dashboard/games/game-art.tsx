import type { GameId } from "./catalog";
import { ChessPiece, CheckerPiece, LudoPiece } from "./pieces";

// Original, code-native illustrations. No remote artwork or tracking assets.
export function GameArt({ game }: { game: GameId }) {
  if (game === "chess" || game === "checkers" || game === "ludo") return <div className={`lounge-art premium-card-art premium-card-art--${game}`} aria-hidden="true">
    <span className="premium-card-art__board"/>
    {game === "chess" ? <><span className="premium-card-piece premium-card-piece--left"><ChessPiece piece="Q"/></span><span className="premium-card-piece premium-card-piece--right"><ChessPiece piece="n"/></span></> : game === "checkers" ? <><span className="premium-card-piece premium-card-piece--left"><CheckerPiece piece={-2}/></span><span className="premium-card-piece premium-card-piece--right"><CheckerPiece piece={2}/></span></> : [0,1,2,3].map((seat) => <span key={seat} className={`premium-card-pawn premium-card-pawn--${seat}`}><LudoPiece seat={seat}/></span>)}
  </div>;
  return <svg className="lounge-art" viewBox="0 0 320 160" fill="none" aria-hidden="true">
    <circle cx="160" cy="80" r="66" fill="currentColor" opacity=".06" />
    {game === "sudoku" && <g transform="translate(105 24) rotate(-8 55 55)"><rect width="110" height="110" rx="12" fill="#fff" stroke="#8ba897" strokeWidth="2" />{[1,2].map((i) => <g key={i}><path d={`M${i*36.7} 0v110M0 ${i*36.7}h110`} stroke="#adc2b0" /></g>)}{["5","3","7","8","1"].map((n,i) => <text key={i} x={18+(i%3)*37} y={27+Math.floor(i/3)*39} textAnchor="middle" fill="#21523c" fontFamily="Georgia" fontSize="24">{n}</text>)}</g>}
    {game === "tic-tac-toe" && <g transform="translate(107 25) rotate(7 55 55)" strokeWidth="5" strokeLinecap="round"><path d="M36 0v110M74 0v110M0 36h110M0 74h110" stroke="#aac0a9" /><path d="m8 8 17 17M25 8 8 25m76 76 17 17m0-17-17 17m-38-55 17 17m0-17-17 17" stroke="#245840" /><circle cx="92" cy="17" r="11" stroke="#c29243" /><circle cx="17" cy="92" r="11" stroke="#c29243" /></g>}
    {game === "trivia" && <><path d="M105 28h110a15 15 0 0 1 15 15v58a15 15 0 0 1-15 15h-62l-31 22v-22h-17a15 15 0 0 1-15-15V43a15 15 0 0 1 15-15z" fill="#fff" stroke="#9eb79e" strokeWidth="2" /><path d="M147 55c0-19 29-19 29-2 0 12-16 12-16 25" stroke="#285b40" strokeWidth="6" strokeLinecap="round" /><circle cx="160" cy="93" r="4" fill="#c6994b" /><path d="m240 32 3 8 9 3-9 3-3 8-3-8-9-3 9-3zM77 105l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#c6994b" /></>}
  </svg>;
}
