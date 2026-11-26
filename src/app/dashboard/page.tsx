import { Suspense } from "react";
import DashboardLoading from "./loading";
import Link from "next/link";
import { requireHodDashboardAccess } from "./access";
import { DashboardShell } from "./dashboard-shell";
import { dashboardNavigation } from "./navigation";
import { OverviewCard, OverviewMetrics } from "./overview-card";
import type { UnreadConversation } from "./connect/model";
import { departmentNames } from "./connect/model";
import { loadMeetings } from "./calendar/server";
import { UpcomingMeetings } from "./calendar/upcoming-meetings";
import { GamesOverview } from "./games/overview";
import { OverviewRecognition, type OverviewWinner, type OverviewWinnerLookup } from "./overview-recognition";

const metricIcons = {
  projects: dashboardNavigation[1].icon,
  tasks: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  messages: dashboardNavigation[3].icon,
  approvals: "M7 3h10v7a5 5 0 0 1-10 0zM7 5H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4m-5 4v5m-4 1h8",
};

export default function Dashboard() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <ProtectedOverview />
    </Suspense>
  );
}

async function ProtectedOverview() {
  const { role, client, user, departments: assignedDepartments } = await requireHodDashboardAccess();
  if (role === "HOD") return <HodOverview client={client} userId={user.id} departments={assignedDepartments}/>;
  const [approvals, plans, myTasks, unread, recognition, meetings] = await Promise.all([
    client.from("approval_requests")
      .select("id,title,department", { count: "exact" }).eq("status", "pending")
      .order("submitted_at", { ascending: false }).order("id").limit(3),
    client.from("department_plans")
      .select("id,title,department,period_kind,period_start").eq("status", "submitted")
      .order("period_start", { ascending: false }).order("id").limit(3),
    client.from("department_plan_items").select("id,department_plans!inner(status)", { count: "exact", head: true })
      .eq("assignee_user_id", user.id).neq("status", "completed").eq("department_plans.status", "submitted"),
    client.rpc("connect_unread_counts"),
    loadRecognitionOverview(client),
    loadMeetings(client, user.id, "upcoming", 200,role),
  ]);

  const count = approvals.error ? null : approvals.count;
  const unreadRows: UnreadConversation[] = Array.isArray(unread.data) ? unread.data : [];
  const metrics = [
    { label: "Active Projects", value: "—", description: "Project tracking setup pending.", icon: metricIcons.projects, href: "/dashboard/projects" },
    { label: "My Tasks", value: myTasks.error ? "—" : myTasks.count ?? 0, description: myTasks.error ? "Task count unavailable." : "Open tasks assigned to you.", icon: metricIcons.tasks, href: "/dashboard/projects" },
    { label: "Unread Messages", value: unread.error ? "—" : unreadRows.reduce((total, row) => total + Number(row.unread_count), 0), description: unread.error ? "Unread count unavailable." : "Conversations you can access.", icon: metricIcons.messages, href: "/dashboard/connect" },
    { label: "Pending Approvals", value: count ?? "—", description: count === null ? "Approval count unavailable." : "Requests awaiting review.", icon: metricIcons.approvals, href: "/dashboard/approvals", accent: "gold" as const },
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
      <OverviewMetrics items={metrics}/>
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
        <OverviewCard title="Upcoming Meetings" className="overview-meetings-card" action={<Link href="/dashboard/calendar" prefetch={false}>View All</Link>}><UpcomingMeetings initial={meetings} view="upcoming" maxItems={2}/></OverviewCard>
        <OverviewCard title="Quick Actions">
          <div className="eba-overview__links">
            <Link href="/dashboard/approvals">Review approvals →</Link>
            <Link href="/dashboard/projects">View department plans →</Link>
          </div>
        </OverviewCard>
        <OverviewCard title="Submitted department plans" action={<Link href="/dashboard/projects">View plans</Link>}>
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
        <GamesOverview/>
        <OverviewRecognition awards={recognition.awards} profiles={recognition.profiles} unavailable={recognition.unavailable} action={<Link href="/dashboard/insights">See all</Link>}/>
      </div>
    </DashboardShell>
  );
}

async function HodOverview({client,userId,departments}:{client:Awaited<ReturnType<typeof requireHodDashboardAccess>>["client"];userId:string;departments:string[]}){
  const [plans,taskResult,approvalSummary,unread,meetings,recognition]=await Promise.all([
    client.from("department_plans").select("id,title,department,period_kind,period_start")
      .in("department",departments).eq("status","submitted").order("period_start",{ascending:false}).limit(5),
    client.from("department_plan_items").select("id,department_plans!inner(status,department)",{count:"exact",head:true})
      .eq("assignee_user_id",userId).neq("status","completed").eq("department_plans.status","submitted")
      .in("department_plans.department",departments),
    client.rpc("hod_department_approval_summary"),
    client.rpc("connect_unread_counts"),
    loadMeetings(client,userId,"upcoming",200,"HOD"),
    loadRecognitionOverview(client),
  ]);
  const unreadRows:UnreadConversation[]=Array.isArray(unread.data)?unread.data:[];
  const queue=approvalSummary.data as {pending_count:number;items:{request_type:string;department:string;submitted_at:string;status:string}[]}|null;
  const metrics=[
    {label:"Active Projects",value:"—",description:"Project tracking setup pending.",icon:metricIcons.projects,href:"/dashboard/projects"},
    {label:"My Tasks",value:taskResult.error?"—":taskResult.count??0,description:taskResult.error?"Task count unavailable.":"Open tasks assigned to you.",icon:metricIcons.tasks,href:"/dashboard/projects"},
    {label:"Unread Messages",value:unread.error?"—":unreadRows.reduce((n,row)=>n+Number(row.unread_count),0),description:unread.error?"Unread count unavailable.":"Conversations you can access.",icon:metricIcons.messages,href:"/dashboard/connect"},
    {label:"Pending Approvals",value:approvalSummary.error?"—":queue?.pending_count??0,description:approvalSummary.error?"Department approval count unavailable.":"Requests in your assigned departments.",icon:metricIcons.approvals,href:"/dashboard/approvals",accent:"gold" as const},
  ];
  return <DashboardShell role="HOD" section="overview" focus={
    <section className="eba-overview__focus" aria-labelledby="todays-focus">
      <h2 id="todays-focus">Today’s Focus</h2>
      {approvalSummary.error ? <p>Assigned department approvals could not be loaded.</p> : !queue?.pending_count ? <p>No pending approvals in your assigned departments.</p> : <Link href="/dashboard/approvals">{queue.pending_count} pending {queue.pending_count === 1 ? "request" : "requests"} in your assigned departments →</Link>}
    </section>
  }>
    <OverviewMetrics items={metrics} label="Your department workspace"/>
    <div className="eba-overview__grid">
      <OverviewCard title="Needs Attention" action={<Link href="/dashboard/approvals">View approvals</Link>}>
        {approvalSummary.error?<p role="status">Assigned department approvals could not be loaded. Check that the overview update migration is applied.</p>:!queue?.items.length?<p>No pending approvals in your assigned departments.</p>:<ul className="eba-overview__records">{queue.items.map((item,index)=><li key={`${item.department}:${item.request_type}:${item.submitted_at}:${index}`}><Link href="/dashboard/approvals">{item.request_type.replaceAll("_"," ")}<span>{departmentNames[item.department]??item.department} · {new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Lagos",dateStyle:"medium"}).format(new Date(item.submitted_at))} · Pending CEO/Admin review</span></Link></li>)}</ul>}
      </OverviewCard>
      <OverviewCard title="Upcoming Meetings" className="overview-meetings-card" action={<Link href="/dashboard/calendar" prefetch={false}>View All</Link>}>
        <UpcomingMeetings initial={meetings} view="upcoming" maxItems={2}/>
      </OverviewCard>
      <OverviewCard title="Quick Actions">
        <div className="eba-overview__links">
          <Link href="/dashboard/approvals">Review approvals →</Link>
          <Link href="/dashboard/projects">View department plans →</Link>
        </div>
      </OverviewCard>
      <OverviewCard title="Submitted department plans" action={<Link href="/dashboard/projects">View plans</Link>}>
        {plans.error?<p role="status">Department plans could not be loaded.</p>:!plans.data?.length?<p>No submitted plans for your assigned departments yet.</p>:<ul className="eba-overview__records">{plans.data.map((plan)=><li key={plan.id}><Link href={{pathname:"/dashboard/projects",query:{department:plan.department,period:plan.period_kind,date:plan.period_start}}}>{plan.title}<span>{departmentNames[plan.department]??plan.department} · {plan.period_start}</span></Link></li>)}</ul>}
      </OverviewCard>
      <GamesOverview/>
      <OverviewRecognition awards={recognition.awards} profiles={recognition.profiles} unavailable={recognition.unavailable}/>
    </div>
  </DashboardShell>;
}

async function loadRecognitionOverview(client:Awaited<ReturnType<typeof requireHodDashboardAccess>>["client"]){
  const types=["employee_month","teamwork_month","most_improved_month"];
  const results=await Promise.all(types.map((awardType)=>client.from("period_recognition_results")
    .select("award_type,period_start,outcome,result_label,public_reason,published_at")
    .eq("award_type",awardType).not("published_at","is",null).order("period_start",{ascending:false}).limit(1).maybeSingle()));
  const awards=results.flatMap((row)=>row.data?[row.data as {award_type:string;period_start:string;outcome:"winner"|"no_award";result_label:string;public_reason:string}]:[]);
  const unavailable=types.filter((type,index)=>Boolean(results[index]?.error));
  const profileResults=await Promise.all(awards.filter((award)=>award.outcome==="winner").map(async(award)=>{
    const result=await client.rpc("period_recognition_winner_profiles",{p_award_type:award.award_type,p_period_start:award.period_start}).returns<OverviewWinner[]>();
    return [award.award_type,{data:Array.isArray(result.data)?result.data:[],error:Boolean(result.error)}] as const;
  }));
  return {awards,profiles:new Map<string,OverviewWinnerLookup>(profileResults),unavailable};
}
