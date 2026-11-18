import type { ReactNode } from "react";

export function PendingBadge() {
  return <span className="eba-overview__pending">Pending</span>;
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
