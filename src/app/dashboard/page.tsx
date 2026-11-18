import { Suspense } from "react";
import DashboardLoading from "./loading";
import Link from "next/link";
import { requireDashboardAccess } from "./access";
import { DashboardShell } from "./dashboard-shell";
import { DashboardIcon, dashboardNavigation } from "./navigation";
import { OverviewCard, PendingBadge } from "./overview-card";
import type { UnreadConversation } from "./connect/model";
import { currentRecognitionWeek, loadRecognition, recognitionPath } from "./insights/recognition";
import { nextGameNight, nightDate } from "./games/server";
import { loadMeetings } from "./calendar/server";
import { UpcomingMeetings } from "./calendar/upcoming-meetings";

export default function Dashboard() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <ProtectedOverview />
    </Suspense>
  );
}

async function ProtectedOverview() {
  const { role, client, user } = await requireDashboardAccess();
  const [approvals, plans, unread, recognition, gameNight, meetings] = await Promise.all([
    client.from("approval_requests")
      .select("id,title,department", { count: "exact" }).eq("status", "pending")
      .order("submitted_at", { ascending: false }).order("id").limit(3),
    client.from("department_plans")
      .select("id,title,department,period_kind,period_start").eq("status", "submitted")
      .order("period_start", { ascending: false }).order("id").limit(3),
    client.rpc("connect_unread_counts"),
    loadRecognition(client, currentRecognitionWeek()),
    nextGameNight(client),
    loadMeetings(client, user.id, "today", 200,role),
  ]);

  const count = approvals.error ? null : approvals.count;
  const unreadRows: UnreadConversation[] = Array.isArray(unread.data) ? unread.data : [];
  const tiles = [
    { label: "Active Projects", icon: dashboardNavigation[1].icon, pending: "Project tracking setup pending." },
    { label: "My Tasks", icon: dashboardNavigation[2].icon, pending: "Task assignments setup pending." },
  ];

  return (
    <DashboardShell role={role} section="overview" focus={
      <section className="eba-overview__focus" aria-labelledby="todays-focus">
        <h2 id="todays-focus">Today’s Focus</h2>
        {count === null ? <p>Approvals could not be loaded.</p> : count === 0 ? (
          <p>No pending approvals.</p>
        ) : (
          <Link href="/dashboard/approvals">Review {count} pending {count === 1 ? "request" : "requests"} →</Link>
        )}
      </section>
    }>
      <section className="eba-overview__tiles" aria-label="Workspace summary">
        {tiles.map(({ label, icon, pending }) => (
          <div className="eba-overview__tile" key={label}>
            <DashboardIcon path={icon} />
            <div><h2>{label}</h2><PendingBadge /><p>{pending}</p></div>
          </div>
        ))}
        <div className="eba-overview__tile">
          <DashboardIcon path={dashboardNavigation[3].icon} />
          <div><h2>Unread Messages</h2>
            {unread.error ? <p>Count unavailable.</p> : <p className="eba-overview__count">
              {unreadRows.reduce((total, row) => total + Number(row.unread_count), 0)}
            </p>}
          </div>
        </div>
        <div className="eba-overview__tile" data-accent="gold">
          <DashboardIcon path="M7 3h10v7a5 5 0 0 1-10 0zM7 5H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4m-5 4v5m-4 1h8" />
          <div><h2>Pending Approvals</h2>
            {count === null ? <p>Count unavailable.</p> : <p className="eba-overview__count">{count}</p>}
          </div>
        </div>
      </section>
      <div className="eba-overview__grid">
        <OverviewCard title="Needs Attention">
          {approvals.error ? <p>Approvals could not be loaded.</p> : approvals.data.length === 0 ? (
            <p>No requests awaiting review.</p>
          ) : (
            <ul className="eba-overview__records">
              {approvals.data.map((request) => (
                <li key={request.id}>
                  <Link href={{ pathname: "/dashboard/approvals", query: { request: request.id } }} prefetch={false}>
                    {request.title}<span>{request.department}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </OverviewCard>
        <OverviewCard title="Upcoming Meetings" className="overview-meetings-card" action={<Link href="/dashboard/calendar" prefetch={false}>View All</Link>}><UpcomingMeetings initial={meetings}/></OverviewCard>
        <OverviewCard title="Quick Actions">
          <div className="eba-overview__links">
            <Link href="/dashboard/approvals">Review approvals →</Link>
            <Link href="/dashboard/projects">View department plans →</Link>
          </div>
        </OverviewCard>
        <OverviewCard title="Project Progress" pending>
          <p>Progress tracking setup pending.</p>
          {plans.error ? <p>Department plans could not be loaded.</p> : plans.data.length === 0 ? (
            <p>No department plans submitted yet.</p>
          ) : (
            <>
              <h3>Recent submitted plans</h3>
              <ul className="eba-overview__records">
                {plans.data.map((plan) => (
                  <li key={plan.id}>
                    <Link href={{ pathname: "/dashboard/projects", query: {
                      department: plan.department, period: plan.period_kind, date: plan.period_start,
                    } }}>{plan.title}<span>{plan.department}</span></Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </OverviewCard>
        <OverviewCard title="Employee Recognition">
          {recognition.error ? <p>Recognition could not be loaded.</p> : recognition.data ? (
            <><strong>{recognition.data.winner_name}</strong><p>{recognition.data.reason}</p></>
          ) : <p>No winner announced for this week.</p>}
          <div className="eba-overview__links"><Link href={recognitionPath}>View recognition →</Link></div>
        </OverviewCard>
        <OverviewCard title="Friday Game Night" featured>
          {gameNight.error ? <p>Game Night could not be loaded.</p> : gameNight.night ? <><strong>{gameNight.night.title}</strong><p>{nightDate(gameNight.night.starts_at)} · Africa/Lagos</p><Link href={`/dashboard/games?session=${gameNight.night.id}`}>Join Game Night →</Link></> : <p>No Game Night scheduled</p>}
        </OverviewCard>
      </div>
    </DashboardShell>
  );
}
