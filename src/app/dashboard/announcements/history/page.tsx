import { Suspense } from "react";
import Link from "next/link";
import { requireHodDashboardAccess } from "../../access";
import { DashboardShell } from "../../dashboard-shell";
import DashboardLoading from "../loading";
import { AnnouncementHistoryList, type AnnouncementHistoryEntry } from "../history-list";
export default function AnnouncementHistoryPage() {
  return <Suspense fallback={<DashboardLoading />}><ProtectedAnnouncementHistory /></Suspense>;
}

async function ProtectedAnnouncementHistory() {
  const { client, role } = await requireHodDashboardAccess();
  const { data, error } = await client.rpc("announcement_history");
  const entries = (data ?? []) as AnnouncementHistoryEntry[];
  return <DashboardShell role={role} section="announcements">
    <AnnouncementHistoryList entries={entries} error={Boolean(error)}/>
    {role !== "HOD" && <Link className="eba-announcements__secondary" href="/dashboard/announcements">Manage announcements</Link>}
  </DashboardShell>;
}
