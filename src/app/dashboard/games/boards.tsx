"use client";
import { useEffect, useRef, useState } from "react";
import type { Move, RoomView } from "./catalog";
import { ludoMoves, ludoSafe, ludoSquare } from "./rules";
import { ChessPiece, CheckerPiece, LudoPiece, chessNames } from "./pieces";

type Props = { view: RoomView; disabled: boolean; send: (move: Move) => void };
export function SquareBoard({ view, disabled, send }: Props) {
  const [selected, setSelected] = useState<number | null>(null), [promotion, setPromotion] = useState("q");
  const state = view.state!;
  const chess = view.room.game === "chess", tic = view.room.game === "tic-tac-toe", size = tic ? 3 : 8;
  const me = view.players.find((p) => p.user_id === view.self)?.seat;
  const mine = me === state.turn && !disabled && view.room.status === "active";
  let board: (number | string)[] = state.board;
  if (chess) board = (state.fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1").split(" ")[0].split("/").flatMap((row) => [...row].flatMap((piece) => /[1-8]/.test(piece) ? Array<string>(Number(piece)).fill("") : [piece]));
  const legal = view.legal ?? [];
  const available = (index: number) => selected !== null && legal.some((move) => move.from === selected && move.to === index);
  const names = chess ? ["Ivory", "Ebony"] : ["Coral", "Emerald"];
  const flipped = !tic && me !== undefined && (chess ? me !== state.first : me === 0);
  const turnPlayer = view.players.find((player) => player.seat === state.turn);
  const winningLine = tic && view.room.result?.winner !== undefined
    ? [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]].find((line) => line.every((index) => state.board[index] !== 0 && state.board[index] === state.board[line[0]]))
    : undefined;
  function choose(index: number) {
    if (tic) { send({ type: "place", to: index }); return; }
    if (selected !== null && available(index)) { send({ type: "move", from: selected, to: index, ...(chess ? { promotion } : {}) }); setSelected(null); }
    else if (legal.some((move) => move.from === index)) setSelected(index === selected ? null : index);
  }
  return <div className={`lounge-board-wrap ${tic ? "" : "premium-game"}`}>
    {!tic && <div className="premium-game__turn"><span className="premium-game__seal" aria-hidden="true">{chess ? "♔" : "◎"}</span><div><strong>{view.room.status === "finished" ? "A game well played" : mine ? "Your move" : `${turnPlayer?.display_name ?? "Opponent"}’s move`}</strong><span>{view.check ? "King in check" : chess ? "The classic. Beautifully played." : "Make every jump count."}</span></div><span className="premium-game__round">Round {view.room.round}</span></div>}
    {chess && <label className="lounge-promotion">Promotion piece <select value={promotion} onChange={(e) => setPromotion(e.target.value)}><option value="q">Queen</option><option value="r">Rook</option><option value="b">Bishop</option><option value="n">Knight</option></select></label>}
    <div className={tic ? "" : "premium-board-frame"}>
    {!tic && <><div className="premium-board-ranks" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <span key={i}>{flipped ? i + 1 : 8 - i}</span>)}</div><div className="premium-board-files" aria-hidden="true">{[...(flipped ? "hgfedcba" : "abcdefgh")].map((file) => <span key={file}>{file}</span>)}</div></>}
    <div className={`lounge-board lounge-board--${tic ? "tic" : "squares"} ${tic ? "" : chess ? "premium-board--chess" : "premium-board--checkers"}`} role="group" aria-label={`${view.room.game} board`} style={{ gridTemplateColumns: `repeat(${size}, minmax(0,1fr))` }}>
      {board.map((_, displayIndex) => {
        const index = flipped ? 63 - displayIndex : displayIndex;
        const piece = board[index];
        const value = chess ? piece ? `${String(piece) === String(piece).toUpperCase() ? "white" : "black"} ${chessNames[String(piece).toLowerCase()]}` : "" : tic ? piece === 1 ? "X" : piece === 2 ? "O" : "" : piece ? `${Number(piece) > 0 ? "coral" : "emerald"} ${Math.abs(Number(piece)) === 2 ? "king" : "checker"}` : "";
        const label = tic ? `Square ${index + 1}` : `${"abcdefgh"[index % 8]}${8 - Math.floor(index / 8)}`;
        return <button type="button" key={index} aria-label={`${label}, ${value || "empty"}${available(index) ? ", legal destination" : ""}`} aria-pressed={selected === index} disabled={!mine || (tic && Boolean(piece))} data-dark={(Math.floor(index / size) + index % size) % 2 === 1} data-side={chess ? String(piece) === String(piece).toUpperCase() ? "white" : "black" : Number(piece) > 0 ? "red" : "black"} data-legal={available(index)} data-occupied={Boolean(piece)} data-movable={!tic && mine && legal.some((move) => move.from === index)} onClick={() => choose(index)}>{tic ? value : chess ? piece && <ChessPiece piece={String(piece)}/> : Boolean(piece) && <CheckerPiece piece={Number(piece)}/>}</button>;
      })}
      {winningLine && <svg className="lounge-tic-line" viewBox="0 0 300 300" aria-label="Three in a row" role="img"><line x1={(winningLine[0] % 3) * 100 + 50} y1={Math.floor(winningLine[0] / 3) * 100 + 50} x2={(winningLine[2] % 3) * 100 + 50} y2={Math.floor(winningLine[2] / 3) * 100 + 50} pathLength="1" /></svg>}
    </div>
    </div>
    {!tic && <div className="premium-game__hint" role="status"><span>{selected === null ? "Select a piece to see its legal moves." : `Selected ${"abcdefgh"[selected % 8]}${8 - Math.floor(selected / 8)} · Choose a highlighted square.`}</span><span className="premium-game__legend"><i aria-hidden="true"/> Legal move</span></div>}
    {!tic && <p className="lounge-board-caption">{view.players.map((p) => `${p.display_name}: ${names[chess ? (p.seat === (view.room.round - 1) % 2 ? 0 : 1) : p.seat]}`).join(" · ")}{state.forced !== null && " · Continue jumping with the same piece."}{view.check && " · Check!"}</p>}
  </div>;
}

const path: [number, number][] = [
  [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
  [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],
  [8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],
  [13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
];
const homes: [number,number][] = [[7,1],[1,7],[7,13],[13,7]];
const colors = ["Green", "Gold", "Coral", "Blue"];
function tokenPosition(seat: number, token: number, progress: number): [number,number] {
  if (progress === -1) { const r = seat < 2 ? 1.5 : 10.5, c = seat === 0 || seat === 3 ? 1.5 : 10.5; return [r + Math.floor(token / 2) * 2, c + token % 2 * 2]; }
  if (progress < 52) return path[ludoSquare(seat, progress)];
  const [r,c] = homes[seat], offset = progress - 52;
  return [r + (7-r) / 6 * offset, c + (7-c) / 6 * offset];
}
export function LudoBoard({ view, disabled, send }: Props) {
  const state = view.state!, me = view.players.find((p) => p.user_id === view.self)?.seat;
  const mine = me === state.turn && !disabled && view.room.status === "active";
  const legal = me !== undefined ? ludoMoves(state, me) : [];
  const pips: Record<number, number[]> = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  const pawns = state.tokens.flatMap((tokens,seat) => tokens.map((progress,token) => {
    const [row,col] = tokenPosition(seat,token,progress);
    return { seat, token, progress, row, col };
  }));
  return <div className="lounge-ludo premium-game">
    <div className="premium-game__turn"><span className="premium-game__seal" aria-hidden="true">⚄</span><div><strong>{view.room.status === "finished" ? "A game well played" : mine ? "Your move" : `${view.players.find((player) => player.seat === state.turn)?.display_name ?? "Opponent"}’s move`}</strong><span>A little luck. A little strategy.</span></div><span className="premium-game__round">Round {view.room.round}</span></div>
    <div className="premium-ludo-players">{view.players.map((player) => <div key={player.user_id} data-turn={player.seat === state.turn} data-seat={player.seat}><i aria-hidden="true"/><span>{player.user_id === view.self ? "You" : player.display_name}<small>{colors[player.seat]}</small></span></div>)}</div>
    <div className="premium-ludo-frame"><div className="premium-ludo-table">
    <svg className="premium-ludo-track" viewBox="0 0 450 450" role="img" aria-label="Ludo track with safe stars and four private home lanes">
      <defs><linearGradient id="ludo-ivory" x2="1" y2="1"><stop stopColor="#fffaf0"/><stop offset="1" stopColor="#eaddc6"/></linearGradient></defs>
      <rect width="450" height="450" fill="#f3e9d5" />
      {[[0,0],[0,270],[270,270],[270,0]].map(([y,x],seat) => <g key={seat}><rect x={x+2} y={y+2} width="176" height="176" rx="6" className={`ludo-color-${seat}`} /><rect x={x+12} y={y+12} width="156" height="156" rx="6" fill="none" stroke="#f1d399" strokeWidth="1.5" strokeOpacity=".65"/>{[0,1,2,3].map((token) => <g key={token}><circle cx={x+60+token%2*60} cy={y+60+Math.floor(token/2)*60} r="23" fill="#000" opacity=".12"/><circle cx={x+60+token%2*60} cy={y+60+Math.floor(token/2)*60} r="24" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="1.5"/></g>)}</g>)}
      {path.map(([r,c],i) => <g key={i}><rect x={c*30+1} y={r*30+1} width="28" height="28" rx="2" fill={ludoSafe.includes(i)?"#ecd391":"url(#ludo-ivory)"} stroke="#cbbd9f" strokeWidth=".6" />{ludoSafe.includes(i) && <path d={`M${c*30+15} ${r*30+6}l2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6-4.4-4.3 6.1-.9z`} fill="none" stroke="#a67b29" strokeWidth="1.3"/>}</g>)}
      {homes.map(([r,c],seat) => Array.from({length:6},(_,i) => <rect key={`${seat}-${i}`} x={(c+(7-c)/6*i)*30+1} y={(r+(7-r)/6*i)*30+1} width="28" height="28" rx="2" className={`ludo-color-${seat}`} stroke="#f1d399" strokeWidth=".6" />))}
      {[["180,180 225,225 180,270",0],["180,180 270,180 225,225",1],["270,180 270,270 225,225",2],["180,270 270,270 225,225",3]].map(([points,seat]) => <polygon key={seat} points={String(points)} className={`ludo-color-${seat}`} stroke="#e9d8b4" strokeWidth="1"/>)}
      <circle cx="225" cy="225" r="14" fill="#fff4d7" stroke="#c59f52"/><path d="m216 229 1-10 5 5 3-8 3 8 5-5 1 10z" fill="#ad873f"/>
    </svg>
    <div className="premium-ludo-pawns">{pawns.map((pawn) => {
      const { seat, token, progress, row:r, col:c } = pawn;
      const stack = pawns.filter((other) => other.row === r && other.col === c);
      const stackIndex = stack.indexOf(pawn);
      const dx = stack.length > 1 ? (stackIndex % 2 - .5) * .4 : 0;
      const dy = stack.length > 2 ? (Math.floor(stackIndex / 2) - .5) * .35 : 0;
      const canMove = mine && seat === me && legal.includes(token);
      return <button type="button" key={`${seat}-${token}`} className="premium-ludo-pawn" data-legal={canMove} data-stacked={stack.length>1} aria-label={`${colors[seat]} token ${token+1}, ${progress===-1?"at base":progress===57?"home":`step ${progress}`}${canMove?", movable":""}`} disabled={!canMove} style={{left:`${(c+.5+dx)/15*100}%`,top:`${(r+.5+dy)/15*100}%`}} onClick={()=>send({type:"token",token})}><LudoPiece seat={seat}/><small>{token+1}</small></button>;
    })}</div></div></div>
    <div className="premium-dice-controls"><div className="premium-die" aria-label={state.dice === null ? "Die not rolled" : `Die: ${state.dice}`}>{state.dice === null ? <span className="premium-die__idle">✦</span> : Array.from({length:9},(_,index)=><i key={index} data-pip={pips[state.dice ?? 0]?.includes(index)}/>)}</div><div><strong aria-live="polite">{state.dice === null ? "Ready to roll" : `Rolled ${state.dice}`}</strong><span>{state.dice === null ? "Your next move starts here." : legal.length ? "Choose a highlighted pawn." : "Waiting for the next turn."}</span></div><button type="button" className="eba-games__primary" disabled={!mine || state.dice !== null} onClick={() => send({type:"roll"})}>Roll dice</button></div>
    {me !== undefined && <div className="lounge-tokens premium-token-tray">{state.tokens[me].map((p,i) => <button type="button" key={i} disabled={!mine || !legal.includes(i)} onClick={() => send({type:"token",token:i})}><span className="premium-token-preview"><LudoPiece seat={me}/></span><span>Pawn {i+1}<small>{p===-1?"At base":p===57?"Home":`Step ${p}`}</small></span></button>)}</div>}
    <p className="lounge-board-caption">{view.players.map((p) => `${p.display_name}: ${colors[p.seat]}`).join(" · ")} · ☆ Safe squares</p>
  </div>;
}

export function TriviaBoard({ view, disabled, send, now }: Props & { now: number }) {
  const state = view.state!, question = view.question;
  const closing = useRef<number | null>(null);
  useEffect(() => {
    if (!disabled && state.phase === "question" && now >= state.deadline && closing.current !== state.question) {
      closing.current = state.question;
      send({type:"close"});
    }
  }, [disabled, now, send, state.phase, state.deadline, state.question]);
  if (!question) return <p>The host will open a question.</p>;
  const seconds = Math.max(0, Math.ceil((state.deadline - now) / 1000));
  return <section className="lounge-trivia"><div className="lounge-trivia__meta"><span>Question {state.question+1} of 8</span><strong role="timer" aria-label="Seconds remaining">{state.phase === "question" ? `${seconds}s` : "Answers revealed"}</strong></div><h3>{question.text}</h3>
    <div>{question.options.map((option,index) => <button type="button" key={option} disabled={disabled || state.phase !== "question" || seconds===0 || question.answered} data-correct={question.correct===index} onClick={() => send({type:"answer",answer:index})}><span>{"ABCD"[index]}</span>{option}{question.correct===index && " ✓"}</button>)}</div>
    <p role="status">{state.phase === "question" ? question.answered ? "Answer received. Results appear after the timer closes." : "Choose one answer. Correct answers stay private until time is up." : `Correct answer: ${question.options[question.correct!]}`}</p>
    {state.phase === "question" && seconds===0 && <button type="button" disabled={disabled} onClick={() => send({type:"close"})}>Close question and score</button>}
    {state.phase === "revealed" && !state.result && view.room.host_id===view.self && <button type="button" className="eba-games__primary" disabled={disabled} onClick={() => send({type:"next"})}>Next question →</button>}
    <ol className="lounge-scores">{view.players.map((p) => <li key={p.user_id}><span>{p.display_name}</span><strong>{state.scores[p.seat] ?? 0} pts</strong></li>)}</ol>
  </section>;
}

