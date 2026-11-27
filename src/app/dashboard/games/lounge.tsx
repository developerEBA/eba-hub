"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { gameCatalog, uuidPattern, type GameId } from "./catalog";
import { GameArt } from "./game-art";
import { GameRoomClient } from "./room";
import { Sudoku } from "./sudoku";
import { GameInvitations, LoungeWelcome, PersonalGameRecord } from "./lounge-overview";
import type { loadLounge } from "./server";

type LoungeData = Awaited<ReturnType<typeof loadLounge>>;
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export function GamesLounge({
  initial,
  role,
  userId,
  sessionId: initialSessionId,
}: {
  initial: LoungeData;
  role: "CEO" | "Admin" | "HOD";
  userId: string;
  sessionId?: string;
}) {
  const params = useSearchParams();
  const room = params.get("room");
  const roomId = room && uuidPattern.test(room) ? room : undefined;
  const playingSudoku = params.get("play") === "sudoku";
  const sessionId = params.get("session") ?? initialSessionId;
  const requestedGame = params.get("game");
  const initialFilter = gameCatalog.some(
    (game) => game.id === requestedGame && game.id !== "sudoku",
  )
    ? (requestedGame as GameId)
    : "all";
  const [data, setData] = useState(initial),
    [create, setCreate] = useState<GameId | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false),
    [filter, setFilter] = useState<string>(initialFilter);
  const busy = useRef(false),
    refreshing = useRef(false);
  const createDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (create) createDialog.current?.showModal();
  }, [create]);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch("/dashboard/games/api", { cache: "no-store" });
      const value = await response.json();
      if (response.ok) setData(value);
      else setError(value.error ?? "Sign in again to refresh rooms.");
    } catch {
      setError("Unable to refresh the lobby. Check your connection.");
    } finally {
      refreshing.current = false;
    }
  }, []);
  useEffect(() => {
    if (!initial.ready || roomId || playingSudoku) return;
    const events = new EventSource("/dashboard/games/events");
    events.addEventListener("refresh", refresh);
    const timer = setInterval(refresh, 10000);
    return () => {
      events.close();
      clearInterval(timer);
    };
  }, [initial.ready, roomId, playingSudoku, refresh]);
  async function submit(body: Record<string, unknown>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/dashboard/games/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Action failed.");
      if (result.room) {
        setCreate(null);
        window.history.pushState(null, "", `/dashboard/games?room=${result.room}`);
      } else if (result.session) {
        await refresh();
        window.history.pushState(null, "", `/dashboard/games?session=${result.session}`);
      } else {
        setNotice("Session updated.");
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (roomId) return <GameRoomClient key={roomId} id={roomId} members={data.members} />;
  if (playingSudoku)
    return (
      <>
        <Link
          className="eba-games__back"
          href="/dashboard/games"
          onNavigate={(event) => {
            event.preventDefault();
            window.history.pushState(null, "", "/dashboard/games");
          }}
        >
          ← Games library
        </Link>
        <h1 id="games-title">Sudoku</h1>
        <Sudoku key={userId} userId={userId} />
      </>
    );
  const session = sessionId ? data.sessions.find((night) => night.id === sessionId) : undefined;
  const rooms = data.rooms.filter(
    (room) =>
      (!sessionId || room.session_id === sessionId) && (filter === "all" || room.game === filter),
  );
  const featured = session ?? data.sessions[0];
  return (
    <div className="lounge" aria-labelledby="games-title">
      <header className="lounge-heading">
        <div>
          <h1 id="games-title">
            Games Lounge<span>.</span>
          </h1>
          <p>A little friendly competition.</p>
        </div>
        <span className="lounge-heading__aside">Good company. Great games.</span>
      </header>
      <GameInvitations
        invitations={(data.invitations ?? []).filter(
          (invitation) =>
            !data.players.some(
              (player) => player.room_id === invitation.id && player.user_id === userId,
            ),
        )}
        members={data.members}
      />
      {data.invitesError && (
        <p className="lounge-notice" role="status">
          Your invitations couldn’t be loaded. Refresh to try again.
        </p>
      )}
      <div className="lounge-intro">
        <LoungeWelcome />
        <PersonalGameRecord />
      </div>
      {data.error && (
        <p className="lounge-notice" role="status">
          {data.error} Solo Sudoku is ready to play.
        </p>
      )}
      {error && (
        <p className="lounge-notice" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section aria-labelledby="lounge-library-title">
        <div className="lounge-section-heading">
          <h2 id="lounge-library-title">Choose your next move.</h2>
          <span>Six ways to take a break</span>
        </div>
        <div className="lounge-library">
          {[...gameCatalog]
            .sort(
              (a, b) =>
                ["tic-tac-toe", "ludo", "chess", "checkers", "sudoku", "trivia"].indexOf(a.id) -
                ["tic-tac-toe", "ludo", "chess", "checkers", "sudoku", "trivia"].indexOf(b.id),
            )
            .map((game) => {
              const available =
                game.id === "sudoku" || (data.ready && (game.id !== "chess" || data.chessReady));
              return (
                <article key={game.id} className={`lounge-card lounge-card--${game.id}`}>
                  <div className="lounge-card__art">
                    <GameArt game={game.id} />
                  </div>
                  <div className="lounge-card__body">
                    <span className="lounge-tag">
                      {game.kind}
                      {game.id === "ludo" || game.id === "trivia"
                        ? " · 2–4 players"
                        : game.id !== "sudoku"
                          ? " · 2 players"
                          : ""}
                    </span>
                    <h3>{game.name}</h3>
                    <p>{game.description}</p>
                    {game.id === "sudoku" ? (
                      <Link
                        className="lounge-card__action"
                        href="/dashboard/games?play=sudoku"
                        prefetch={false}
                        onNavigate={(event) => {
                          event.preventDefault();
                          window.history.pushState(null, "", "/dashboard/games?play=sudoku");
                        }}
                      >
                        Play Sudoku <span aria-hidden="true">↗</span>
                      </Link>
                    ) : available ? (
                      <button
                        type="button"
                        className="lounge-card__action"
                        onClick={() => setCreate(create === game.id ? null : game.id)}
                      >
                        Create Room <span aria-hidden="true">↗</span>
                      </button>
                    ) : (
                      <p className="lounge-card__pending">
                        {game.id === "chess" && !data.chessReady
                          ? "Chess is being prepared"
                          : "Multiplayer setup pending"}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
        </div>
      </section>
      {create && (
        <dialog
          ref={createDialog}
          className="lounge-panel lounge-create-dialog"
          aria-labelledby="create-room-title"
          onCancel={() => setCreate(null)}
        >
          <div className="lounge-section-heading">
            <h2 id="create-room-title">
              Create a {gameCatalog.find((g) => g.id === create)?.name} room
            </h2>
            <button type="button" onClick={() => setCreate(null)}>
              Cancel
            </button>
          </div>
          {error && (
            <p className="lounge-notice" role="alert">
              {error}
            </p>
          )}
          <form
            className="lounge-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void submit({
                command: "create",
                game: create,
                capacity: Number(form.get("capacity") ?? 2),
                visibility: form.get("visibility"),
                session: form.get("session") || null,
              });
            }}
          >
            {(create === "ludo" || create === "trivia") && (
              <label>
                Seats
                <select name="capacity" defaultValue="4">
                  <option value="2">2 players</option>
                  <option value="3">3 players</option>
                  <option value="4">4 players</option>
                </select>
              </label>
            )}
            <label>
              Who can join?
              <select name="visibility" defaultValue="open">
                <option value="open">Any authorized Hub member</option>
                <option value="invite">Invited staff only</option>
              </select>
            </label>
            <label>
              Game Night
              <select
                name="session"
                defaultValue={session?.games.includes(create) ? session.id : ""}
              >
                <option value="">Standalone room</option>
                {data.sessions
                  .filter((night) => night.games.includes(create))
                  .map((night) => (
                    <option key={night.id} value={night.id}>
                      {night.title} · {dateLabel(night.starts_at)}
                    </option>
                  ))}
              </select>
            </label>
            <button type="submit" className="eba-games__primary" disabled={pending}>
              {pending ? "Creating…" : "Create room"}
            </button>
          </form>
        </dialog>
      )}
      <section className="lounge-panel" aria-labelledby="open-rooms-title">
        <div className="lounge-section-heading">
          <div>
            <h2 id="open-rooms-title">
              {session
                ? `${session.title} lobby`
                : sessionId
                  ? "Session lobby"
                  : "Around the tables"}
            </h2>
            {sessionId && <Link href="/dashboard/games">Show all rooms</Link>}
          </div>
          <label className="lounge-filter">
            <span className="sr-only">Filter rooms by game</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All games</option>
              {gameCatalog
                .filter((g) => g.id !== "sudoku")
                .map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {sessionId && !session && (
          <p>
            This session is completed, cancelled, or unavailable. Its rooms remain below when
            accessible.
          </p>
        )}
        {!rooms.length ? (
          <div className="lounge-empty">
            <h3>
              {data.error
                ? "The multiplayer lounge is getting ready."
                : "The next table could be yours."}
            </h3>
            <p>
              {data.error
                ? "No live room data is available yet."
                : "Create a room above and invite a colleague to join."}
            </p>
          </div>
        ) : (
          <ul className="lounge-room-list">
            {rooms.map((room) => {
              const players = data.players.filter((p) => p.room_id === room.id);
              return (
                <li key={room.id}>
                  <div>
                    <strong>{gameCatalog.find((g) => g.id === room.game)?.name}</strong>
                    <p>{players.map((p) => p.display_name).join(", ") || "No remaining players"}</p>
                  </div>
                  <span className="lounge-tag">{room.status}</span>
                  <span>
                    {room.status === "waiting"
                      ? `${Math.max(0, room.capacity - players.length)} seats open`
                      : `${players.length} players`}
                  </span>
                  <Link
                    href={`/dashboard/games?room=${room.id}`}
                    prefetch={false}
                    onNavigate={(event) => {
                      event.preventDefault();
                      window.history.pushState(null, "", `/dashboard/games?room=${room.id}`);
                    }}
                  >
                    {room.status === "waiting" ? "Open room →" : "View room →"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="lounge-night" aria-labelledby="game-night-title">
        <div className="lounge-night__mark" aria-hidden="true">
          ✦
        </div>
        <div>
          <h2 id="game-night-title">{featured?.title ?? "Friday Game Night"}</h2>
          <p>
            {featured
              ? `${dateLabel(featured.starts_at)} · Africa/Lagos`
              : "Good games are better together. Watch this space for the next Game Night."}
          </p>
        </div>
        {featured && (
          <Link className="eba-games__primary" href={`/dashboard/games?session=${featured.id}`}>
            Join Game Night →
          </Link>
        )}
      </section>
      <p className="lounge-social-note">
        A friendly space to unwind. Game results are separate from employee performance and
        recognition.
      </p>
      {role === "Admin" && (
        <details className="lounge-panel lounge-schedule">
          <summary>Plan Friday Game Night</summary>
          <p>
            Choose the date and time in Africa/Lagos. Create associated rooms from the game cards
            after scheduling.
          </p>
          <form
            className="lounge-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void submit({
                command: "schedule",
                title: form.get("title"),
                startsAt: `${form.get("date")}T${form.get("time")}:00+01:00`,
                games: form.getAll("games"),
              });
            }}
          >
            <label>
              Session title
              <input name="title" defaultValue="Friday Game Night" maxLength={100} required />
            </label>
            <label>
              Date
              <input name="date" type="date" required />
            </label>
            <label>
              Time · Africa/Lagos
              <input name="time" type="time" defaultValue="17:00" required />
            </label>
            <fieldset>
              <legend>Games to include</legend>
              {gameCatalog.map((game) => (
                <label key={game.id} className="lounge-checkbox">
                  <input
                    type="checkbox"
                    name="games"
                    value={game.id}
                    disabled={game.id === "chess" && !data.chessReady}
                  />
                  {game.name}
                </label>
              ))}
            </fieldset>
            <button type="submit" className="eba-games__primary" disabled={pending || !data.ready}>
              {pending ? "Saving…" : "Schedule Game Night"}
            </button>
          </form>
          {data.sessions.map((night) => (
            <div className="lounge-session-control" key={night.id}>
              <span>
                {night.title} · {dateLabel(night.starts_at)}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  submit({ command: "session-status", session: night.id, status: "completed" })
                }
              >
                Mark completed
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Cancel this session? Existing rooms will be retained."))
                    void submit({
                      command: "session-status",
                      session: night.id,
                      status: "cancelled",
                    });
                }}
              >
                Cancel session
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
