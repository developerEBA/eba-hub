import type { ReactNode } from "react";
import Link from "next/link";
import { DashboardIcon } from "./navigation";

export function PendingBadge() {
  return <span className="eba-overview__pending">Pending</span>;
}

export type OverviewMetricItem = {
  label: string;
  value: number | string;
  description: string;
  icon: string;
  href: string;
  accent?: "gold";
};

export function OverviewMetrics({ items, label = "Workspace summary" }: { items: OverviewMetricItem[]; label?: string }) {
  return <section className="eba-overview__tiles" aria-label={label}>
    {items.map((item) => <Link className="eba-overview__tile" data-accent={item.accent} href={item.href} key={item.label}>
      <DashboardIcon path={item.icon}/>
      <div><h2>{item.label}</h2><p className="eba-overview__count">{item.value}</p><p>{item.description}</p></div>
    </Link>)}
  </section>;
}

export function OverviewCard({ title, pending, children, featured,action,className }: {
  title: string;
  pending?: boolean;
  children: ReactNode;
  featured?: boolean;
  action?:ReactNode;
  className?:string;
}) {
  return (
    <section className={`eba-overview__card${className?" "+className:""}`} data-featured={featured}>
      <header>
        <h2>{title}</h2>
        {pending && <PendingBadge />}
        {action}
      </header>
      {children}
    </section>
  );
}
