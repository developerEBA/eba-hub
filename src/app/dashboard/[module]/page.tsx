import { Suspense } from "react";
import DashboardLoading from "../loading";
import { notFound } from "next/navigation";
import { requireDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import { DashboardIcon, dashboardNavigation } from "../navigation";
import { PendingBadge } from "../overview-card";

const pendingModules = dashboardNavigation.slice(4).filter(({ key }) => key !== "insights" && key !== "clients");

export default function DashboardModule({ params }: { params: Promise<{ module: string }> }) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <ProtectedModule params={params} />
    </Suspense>
  );
}

async function ProtectedModule({ params }: { params: Promise<{ module: string }> }) {
  const { role } = await requireDashboardAccess();
  const { module } = await params;
  const entry = pendingModules.find(({ key }) => key === module);
  if (!entry) notFound();

  return (
    <DashboardShell role={role} section={entry.key}>
      <section className="eba-overview__card eba-overview__module" aria-labelledby="module-title">
        <DashboardIcon path={entry.icon} />
        <h1 id="module-title">{entry.label}</h1>
        <PendingBadge />
        <p>{entry.label} setup is pending.</p>
      </section>
    </DashboardShell>
  );
}
