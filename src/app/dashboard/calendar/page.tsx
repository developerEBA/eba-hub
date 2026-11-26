import { Suspense } from "react";
import { requireHodDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import DashboardLoading from "../loading";
import { CalendarClient } from "./calendar-client";
import { loadDirectory, loadMeetings } from "./server";
import "./calendar.css";
import { uuidPattern } from "./model";

type Props = { searchParams: Promise<{ meeting?: string }> };
async function CalendarContent({ searchParams }: Props) {
  const { client, user, role, departments } = await requireHodDashboardAccess();
  const [initial, directory] = await Promise.all([loadMeetings(client, user.id,"week",200,role), loadDirectory(role, departments)]);
  const { meeting } = await searchParams;
  return <DashboardShell role={role} section="calendar"><CalendarClient userId={user.id} initial={initial} directory={directory} canEnd={role==="Admin"} canSchedule={role === "HOD" ? departments.length > 0 : true} canEditMeetings={role !== "HOD"} initialMeetingId={meeting && uuidPattern.test(meeting) ? meeting : undefined}/></DashboardShell>;
}
export default function CalendarPage(props: Props) { return <Suspense fallback={<DashboardLoading/>}><CalendarContent {...props}/></Suspense>; }
