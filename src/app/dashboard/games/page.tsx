import Link from "next/link";
import { Suspense } from "react";
import { requireDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import DashboardLoading from "../loading";
import { Sudoku } from "./sudoku";
import { GamesLounge } from "./lounge";
import { loadGameMembers, loadLounge } from "./server";
import { GameRoomClient } from "./room";
import { uuidPattern } from "./catalog";
import "./games.css";

type Props = { searchParams: Promise<{ play?: string | string[]; room?: string | string[]; session?: string | string[] }> };

async function GamesContent({ searchParams }: Props) {
  const { role, user, client } = await requireDashboardAccess();
  const { play, room, session } = await searchParams;
  const roomId = typeof room === "string" && uuidPattern.test(room) ? room : undefined;
  const lounge = play === "sudoku" || roomId ? null : await loadLounge(client);
  return <DashboardShell role={role} section="games">
    <section className="eba-games" aria-labelledby="games-title">
      {play === "sudoku" ? <>
        <Link className="eba-games__back" href="/dashboard/games">← Games library</Link>
        <h1 id="games-title">Sudoku</h1>
        <Sudoku key={user.id} userId={user.id} />
      </> : roomId ? <GameRoomClient key={roomId} id={roomId} members={[]} membersPromise={loadGameMembers()} /> : lounge && <GamesLounge initial={lounge} role={role} userId={user.id} sessionId={typeof session==="string"&&uuidPattern.test(session)?session:undefined}/>}
    </section>
  </DashboardShell>;
}

export default function Games(props: Props) {
  return <Suspense fallback={<DashboardLoading />}><GamesContent {...props} /></Suspense>;
}

