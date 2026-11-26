import Link from "next/link";
import Image from "next/image";
import { OverviewCard } from "../overview-card";

const overviewGames = [
  { id: "sudoku" as const, name: "Sudoku", description: "A quiet solo puzzle.", href: "/dashboard/games?play=sudoku", action: "Play Sudoku" },
  { id: "ludo" as const, name: "Ludo", description: "A friendly multiplayer race.", href: "/dashboard/games?game=ludo", action: "Browse Ludo rooms" },
];

export function GamesOverview() {
  return <OverviewCard title="Games" featured className="overview-game-shortcuts" action={<Link href="/dashboard/games">Browse all</Link>}>
    <p className="overview-game-shortcuts__intro">Take a quick break with a game or invite your teammates to play.</p>
    <div className="overview-game-shortcuts__visual" aria-hidden="true">
      <Image src="/games/clubhouse.webp" alt="" width={640} height={427} sizes="(max-width: 48rem) 80vw, 28vw" />
      <span>Good games. Good company.</span>
    </div>
    <div className="overview-game-shortcuts__grid">
      {overviewGames.map((game) => <Link className="overview-game-shortcuts__item" href={game.href} key={game.id}>
        <span className="overview-game-shortcuts__copy"><strong>{game.name}</strong><small>{game.description}</small><span>{game.action} <span aria-hidden="true">→</span></span></span>
      </Link>)}
    </div>
  </OverviewCard>;
}
