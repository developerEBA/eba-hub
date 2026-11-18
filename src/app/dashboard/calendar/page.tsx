import { Suspense } from "react";
import { requireDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import DashboardLoading from "../loading";
import { CalendarClient } from "./calendar-client";
import { loadDirectory, loadMeetings } from "./server";
import "./calendar.css";
import { uuidPattern } from "./model";

type Props = { searchParams: Promise<{ meeting?: string }> };
async function CalendarContent({ searchParams }: Props) {
  const { client, user, role } = await requireDashboardAccess();
  const [initial, directory] = await Promise.all([loadMeetings(client, user.id,"week",200,role), loadDirectory()]);
  const { meeting } = await searchParams;
  return <DashboardShell role={role} section="calendar"><CalendarClient userId={user.id} initial={initial} directory={directory} canEnd={role==="Admin"} initialMeetingId={meeting && uuidPattern.test(meeting) ? meeting : undefined}/></DashboardShell>;
}
export default function CalendarPage(props: Props) { return <Suspense fallback={<DashboardLoading/>}><CalendarContent {...props}/></Suspense>; }
