"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { gameCatalog, type Move, type RoomView } from "./catalog";
import { LudoBoard, SquareBoard, TriviaBoard } from "./boards";
import { GameEffects } from "./game-effects";
import { resultText } from "./rules";

type Member = { user_id: string; display_name: string };
export function GameRoomClient({ id, members: initialMembers, membersPromise }: { id: string; members: Member[]; membersPromise?: Promise<Member[]> }) {
  const [members, setMembers] = useState(initialMembers);
  useEffect(() => {
    let active = true;


    if (membersPromise) void Promise.resolve(membersPromise).then((value) => { if (active) setMembers(value); }).catch(() => {});
    return () => { active = false; };
  }, [membersPromise]);
  const [view, setView] = useState<RoomView | null>(null), [error, setError] = useState(""), [pending, setPending] = useState(false), [connected, setConnected] = useState(true);
  const [retry, setRetry] = useState<Record<string, unknown> | null>(null), [now, setNow] = useState(0);
  const [optimisticBoard, setOptimisticBoard] = useState<number[] | null>(null);
  const busy = useRef(false), refreshing = useRef(false), refreshQueued = useRef(false), skew = useRef(0), lastSync = useRef(0);
  const refresh = useCallback(async () => {
    if (refreshing.current) { refreshQueued.current = true; return; }
    refreshing.current = true;
    do {
    refreshQueued.current = false;
    try {
      const response = await fetch(`/dashboard/games/api/${id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { if (response.status !== 409) setError(data.error ?? "Room unavailable."); continue; }
      const next = data as RoomView;
      skew.current = next.serverTime - Date.now(); lastSync.current = Date.now(); setConnected(true);
      setView((current) => !current || next.room.version >= current.room.version ? next : current);
    } catch { setConnected(false); }
    } while (refreshQueued.current);
    refreshing.current = false;
  }, [id]);
  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const events = new EventSource(`/dashboard/games/events?room=${id}`);
    events.addEventListener("refresh", refresh);
    const poll = setInterval(refresh, 5000);
    const clock = setInterval(() => { setNow(Date.now() + skew.current); if (lastSync.current && Date.now() - lastSync.current > 15000) setConnected(false); }, 1000);
    const resume = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", refresh); document.addEventListener("visibilitychange", resume);
    return () => { clearTimeout(initial); events.close(); clearInterval(poll); clearInterval(clock); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", resume); };
  }, [id, refresh]);
  const me = view?.players.find((p) => p.user_id === view.self);
  const participating = Boolean(me);
  useEffect(() => {
    if (!participating) return;
    const ping = () => { void fetch(`/dashboard/games/api/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "presence", requestId: crypto.randomUUID() }) }).catch(() => {}); };
    ping(); const timer = setInterval(ping, 15000); return () => clearInterval(timer);
  }, [id, participating]);
  async function command(body: Record<string, unknown>, retrying = false) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    const payload = retrying ? body : { ...body, version: view?.room.version, requestId: crypto.randomUUID() };
    const move = body.move as Move | undefined;
    if (!retrying && body.command === "move" && view?.room.game === "tic-tac-toe" && view.room.status === "active" && view.state && me?.seat === view.state.turn && move?.type === "place" && Number.isInteger(move.to) && move.to! >= 0 && move.to! < 9 && view.state.board[move.to!] === 0) {
      const board = [...view.state.board];
      board[move.to!] = me.seat === view.state.first ? 1 : 2;
      setOptimisticBoard(board);
    }
    try {
      const response = await fetch(`/dashboard/games/api/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      setRetry(null);
      if (!response.ok) setError(data.error ?? "Move rejected.");
      if (response.ok && data.view) {
        const next = data.view as RoomView;
        setView((current) => !current || next.room.version >= current.room.version ? next : current);
        lastSync.current = Date.now(); setConnected(true);
      } else await refresh();
    } catch { setError("Connection interrupted. Refresh, or retry the same request safely."); setRetry(payload); setConnected(false); }
    finally { busy.current = false; setPending(false); setOptimisticBoard(null); }
  }
  if (!view) return <section className="lounge-room"><Link href="/dashboard/games">← Games Lounge</Link><p role="status">{error || "Opening the room…"}</p><button type="button" onClick={refresh}>Try again</button></section>;
  const game = gameCatalog.find((g) => g.id === view.room.game)!;
  const host = view.room.host_id === view.self, state = view.state, names = view.players.map((p) => p.display_name);
  const send = (move: Move) => { void command({ command: "move", move }); };
  const disabled = pending || !connected || !me;
  return <section className="lounge-room" aria-labelledby="games-title">
    <Link className="eba-games__back" href={view.room.session_id ? `/dashboard/games?session=${view.room.session_id}` : "/dashboard/games"}>← Back to lobby</Link>
    <header className="lounge-room__heading"><div><p className="lounge-eyebrow">{view.room.visibility === "invite" ? "Invited staff" : "Open room"} · Round {view.room.round}</p><h1 id="games-title">{game.name}</h1></div><span className="lounge-tag">{view.room.status}</span></header>
    <div className="lounge-room__status" role="status">{view.room.result ? resultText(view.room.result, names) : view.room.status === "waiting" ? "Gather your players. The host starts when everyone is ready." : view.room.game === "trivia" ? "A friendly quiz. Every answer counts." : `${view.players.find((p) => p.seat === state?.turn)?.display_name ?? "Player"}’s turn`}</div>
    {!connected && <p className="lounge-notice" role="status">Reconnecting… Your seat is reserved. Moves are paused in this browser.</p>}
    {error && <p className="lounge-notice" role="alert">{error}</p>}{retry && <button type="button" disabled={pending} onClick={() => command(retry, true)}>Retry previous request</button>}
    <div className="lounge-room__layout"><div className="lounge-room__play">
      {view.room.game === "tic-tac-toe" && me && <GameEffects view={view}/>}
      {!me ? <div className="lounge-waiting"><h2>A seat at the table.</h2><p>{view.room.capacity-view.players.length} seats available.</p>{view.room.status === "waiting" && <button type="button" className="eba-games__primary" disabled={pending || view.players.length >= view.room.capacity} onClick={() => command({command:"join"})}>Join room</button>}<p>Join to see the board and take part.</p></div> : view.room.status === "waiting" ? <div className="lounge-waiting"><h2>Good company. A little competition.</h2><p>{view.players.length} of {view.room.capacity} seats filled. {host ? "Start with at least two players." : "Waiting for the host to start."}</p>{host && <button type="button" className="eba-games__primary" disabled={pending || view.players.length < 2} onClick={() => command({command:"start"})}>Start {game.name}</button>}</div> : state ? view.room.game === "ludo" ? <LudoBoard view={view} disabled={disabled} send={send} /> : view.room.game === "trivia" ? <TriviaBoard view={view} disabled={disabled} send={send} now={now || view.serverTime} /> : <SquareBoard key={view.room.round} view={optimisticBoard && view.state ? { ...view, state: { ...view.state, board: optimisticBoard } } : view} disabled={disabled} send={send} /> : <p>This match ended before a board was started.</p>}
      {me && view.room.status === "finished" && <div className="lounge-rematch"><button type="button" className="eba-games__primary" disabled={pending || view.players.length < 2 || state?.rematch.includes(me.seat)} onClick={() => command({command:"rematch"})}>{state?.rematch.includes(me.seat) ? "Rematch requested" : "Request a rematch"}</button><p>Every remaining player must agree. {state?.rematch.length ?? 0} of {view.players.length} ready.</p></div>}
    </div><aside className="lounge-room__aside"><h2>At the table</h2><ul className="lounge-players">{view.players.map((p) => <li key={p.user_id} data-turn={view.room.status === "active" && state?.turn === p.seat && view.room.game !== "trivia"}><span className="lounge-avatar">{p.display_name.trim().split(/\s+/).slice(0,2).map((n) => n[0]).join("")}</span><span>{p.display_name}{p.user_id===view.self && " (you)"}<small>{p.user_id===view.room.host_id ? "Host · " : ""}{now && now-Date.parse(p.last_seen)>45000 ? "Away · seat held" : "Connected"}</small></span></li>)}</ul>
      {host && view.room.status === "waiting" && <form className="lounge-invite" onSubmit={(event) => {event.preventDefault();const form=new FormData(event.currentTarget);void command({command:"invite",user:form.get("user")});}}><label>Invite a Hub member<select name="user" required defaultValue=""><option value="" disabled>Choose staff member</option>{members.filter((p) => !view.players.some((member) => member.user_id===p.user_id)).map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></label><button type="submit" disabled={pending}>Send room invitation</button><p>Invited staff will see this room in their lounge. Share its link after inviting.</p></form>}
      <details className="lounge-rules" open><summary>How to play</summary><p>{game.rules}</p></details>
      {me && <><button type="button" disabled={pending} onClick={() => { if (window.confirm("Leave this room? An active match will end for everyone.")) void command({command:"leave"}); }}>Leave room</button>{view.room.status === "active" && view.room.game !== "trivia" && <button type="button" disabled={disabled} onClick={() => { if (window.confirm("Resign this match?")) send({type:"resign"}); }}>Resign match</button>}</>}
      <details className="lounge-rules"><summary>Previous results ({view.history.length})</summary>{view.history.map((entry) => <p key={entry.round}>Round {entry.round}: {resultText(entry.result,names)}</p>)}</details>
      <p className="lounge-social-note">Just for fun. Game results never affect employee performance or recognition.</p>
    </aside></div>
  </section>;
}

