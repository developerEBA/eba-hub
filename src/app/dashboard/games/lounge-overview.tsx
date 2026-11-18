"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import type { GameRoom } from "./catalog";
import { gameCatalog } from "./catalog";
import { GameArt } from "./game-art";
import type { PersonalRecord } from "./record";

export function RoomLink({ room, children, className }: { room: string; children: ReactNode; className?: string }) {
  return <Link className={className} href={`/dashboard/games?room=${room}`} prefetch={false} onNavigate={(event) => {
    event.preventDefault(); window.history.pushState(null, "", `/dashboard/games?room=${room}`);
  }}>{children}</Link>;
}

export function GameInvitations({ invitations, members }: { invitations: GameRoom[]; members: { user_id: string; display_name: string }[] }) {
  if (!invitations.length) return null;
  return <section className="lounge-invitations" aria-label="Your game invitations" aria-live="polite">
    {invitations.map((room) => <article className="lounge-invitation" key={room.id}>
      <div className="lounge-invitation__art"><GameArt game={room.game}/></div>
      <div><h2>You’re invited<span className="lounge-invitation__dot" aria-hidden="true"/></h2><p><strong>{members.find((member) => member.user_id === room.host_id)?.display_name ?? "A colleague"}</strong> saved you a seat at <strong>{gameCatalog.find((game) => game.id === room.game)?.name}</strong>.</p></div>
      <RoomLink room={room.id} className="eba-games__primary">Join table <span aria-hidden="true">↗</span></RoomLink>
    </article>)}
  </section>;
}

export function PersonalGameRecord() {
  const [record, setRecord] = useState<PersonalRecord | null>(null);
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/dashboard/games/api/record", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Record unavailable");
        const value = await response.json() as PersonalRecord;
        if (!controller.signal.aborted) { setRecord(value); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
    })();
    return () => controller.abort();
  }, [attempt]);
  return <section className="lounge-record" aria-labelledby="personal-record-title">
    <header><h2 id="personal-record-title">Your record</h2><span aria-hidden="true">♜</span></header>
    {error ? <div className="lounge-record__empty"><p>Your record couldn’t be loaded.</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div> : !record ? <p className="lounge-record__empty" role="status">Loading your recent rounds…</p> : <>
      <dl className="lounge-record__totals"><div><dt>Wins</dt><dd>{record.wins}</dd></div><div><dt>Losses</dt><dd>{record.losses}</dd></div><div><dt>Draws</dt><dd>{record.draws}</dd></div></dl>
      <div className="lounge-record__streak" data-kind={record.streakKind}><span>Current streak</span><strong>{record.streak ? `${record.streak} ${record.streakKind === "win" ? record.streak === 1 ? "win" : "wins" : record.streakKind === "loss" ? record.streak === 1 ? "loss" : "losses" : record.streak === 1 ? "draw" : "draws"}` : "A fresh start"}</strong></div>
      {record.played ? <><div className="lounge-record__recent"><span>Latest rounds</span><ol aria-label="Recent rounds, newest first">{record.recent.map((outcome, index) => <li key={index} data-outcome={outcome} title={outcome} aria-label={`${index === 0 ? "Latest round" : `Round ${index + 1}`}: ${outcome}`}>{outcome === "win" ? "W" : outcome === "loss" ? "L" : "D"}</li>)}</ol></div><p className="lounge-record__note">Best win streak: {record.bestWinStreak} · Recent {record.played} verified rounds</p></> : <p className="lounge-record__note">Your first completed match starts your story.</p>}
    </>}
    <p className="lounge-record__footnote">Up to 200 recent multiplayer rounds. Just for fun.</p>
  </section>;
}

export function LoungeWelcome() {
  return <section className="lounge-welcome" aria-label="Welcome to the lounge"><div><h2>Play a little.<br/>Connect a lot.</h2><p>Friendly games, quick matches, and a little time for good company.</p><a href="#lounge-library-title">Find your next game <span aria-hidden="true">↗</span></a></div><div className="lounge-welcome__art" aria-hidden="true"><Image src="/games/clubhouse.webp" alt="" width={640} height={427} sizes="(max-width: 550px) 180px, 360px"/></div></section>;
}
