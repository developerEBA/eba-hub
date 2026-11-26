import { Suspense } from "react";
import DashboardLoading from "../loading";
import Link from "next/link";
import { requireHodDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import { departmentNames } from "../connect/model";
import { HodPlanEditor } from "./hod-plan-editor";
import { loadPlanAssignees } from "./assignees";

const departments = [
  ["graphics", "Graphics"],
  ["development", "Development"],
  ["communications", "Communications"],
  ["events", "Events"],
  ["marketing", "Marketing"],
] as const;

const periods = ["week", "month", "year"] as const;
type Period = (typeof periods)[number];
type Query = Record<string, string | string[] | undefined>;

function periodStart(value: Query["date"], period: Period) {
  const validFormat = typeof value === "string" && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value);
  const candidate = validFormat ? new Date(value + "T00:00:00Z") : null;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Lagos" }).format(new Date());
  const date = candidate && !Number.isNaN(candidate.valueOf()) && candidate.toISOString().slice(0, 10) === value
    ? candidate
    : new Date(today + "T00:00:00Z");

  if (period === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  if (period === "month") date.setUTCDate(1);
  if (period === "year") date.setUTCMonth(0, 1);
  return date.toISOString().slice(0, 10);
}

type Plan = {
  id: string;
  department: string;
  period_kind: Period;
  period_start: string;
  title: string;
  summary: string;
  status: "draft"|"submitted";
  version: number;
  created_by: string|null;
  department_plan_items: {
    id: string;
    title: string;
    owner: string;
    assignee_user_id: string|null;
    due_date: string | null;
    status: string;
    completed_at?: string|null;
    completed_by?: string|null;
  }[];
  department_plan_attachments: { id: string; filename: string }[];
};

export default function Projects({ searchParams }: { searchParams: Promise<Query> }) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <ProtectedProjects searchParams={searchParams} />
    </Suspense>
  );
}

async function ProtectedProjects({ searchParams }: { searchParams: Promise<Query> }) {
  const { client, role, user, departments: assignedDepartments } = await requireHodDashboardAccess();

  const query = await searchParams;
  if(role==="HOD"){
    const selected=typeof query.department==="string"&&assignedDepartments.includes(query.department)?query.department:assignedDepartments.length===1?assignedDepartments[0]:null;
    const period=periods.find((key)=>key===query.period)??"week";
    const start=periodStart(query.date,period);
    const result=selected?await client.from("department_plans")
      .select("id,title,summary,department,period_kind,period_start,status,version,created_by,department_plan_items(id,title,owner,assignee_user_id,due_date,status,completed_at,completed_by),department_plan_attachments(id,filename)")
      .eq("department",selected).eq("period_kind",period).eq("period_start",start)
      .order("id",{referencedTable:"department_plan_items"}).order("filename",{referencedTable:"department_plan_attachments"}):null;
    const assignees=selected?await loadPlanAssignees([selected]):{ready:false,people:[]};
    const plans=(result?.data??[]) as Plan[];
    return <DashboardShell role="HOD" section="projects"><section className="eba-plans" aria-labelledby="hod-plans-title">
      <header className="eba-plans__hero"><p className="eba-plans__eyebrow">Your department workspace</p><h1 id="hod-plans-title">Department plans</h1><p>Submitted plans for your authorized department assignments.</p></header>
      <nav className="eba-plans__tabs" aria-label="Assigned departments">{assignedDepartments.map((department)=><Link key={department} href={{pathname:"/dashboard/projects",query:{department,period,date:start}}} aria-current={selected===department?"page":undefined}>{departmentNames[department]??department}</Link>)}</nav>
      <form className="eba-plans__filters" action="/dashboard/projects"><label>Period<select name="period" defaultValue={period}><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></label><label>Date within period<input name="date" type="date" defaultValue={start} required/></label>{selected&&<input type="hidden" name="department" value={selected}/>}<button type="submit">View plans</button></form>
      {!selected?<p>Select a department to create or view its plan. No department is selected automatically when several are assigned.</p>:result?.error?<p role="alert">Department plans could not be loaded. Retry the page after checking access and migration status.</p>:!plans.length?<><p>No plan exists for this department and period yet.</p><HodPlanEditor department={selected} period={period} periodStart={start} existing={null} assignees={assignees.people} assigneesReady={assignees.ready}/></>:plans.map((plan)=><article className="eba-plans__card" key={plan.id}><div className="eba-plans__card-heading"><div><p className="eba-plans__eyebrow">{departmentNames[plan.department]??plan.department}</p><h2>{plan.title}</h2></div><span>{plan.status==="submitted"?"Submitted":"Draft"}</span></div><p>{plan.summary||"No summary was supplied."}</p><h3>Work items</h3>{!plan.department_plan_items?.length?<p>No work items listed.</p>:<ul className="eba-plans__items">{plan.department_plan_items.map((item)=><li key={item.id}><strong>{item.title}</strong><span>{item.owner} · {item.due_date??"No due date"} · {item.status}{item.completed_at?` · Completed ${item.completed_at.slice(0,10)}`:""}</span></li>)}</ul>}<h3>Private attachments</h3>{!plan.department_plan_attachments?.length?<p>No attachments.</p>:<ul className="eba-plans__items">{plan.department_plan_attachments.map((file)=><li key={file.id}><a href={`/dashboard/projects/attachments/${file.id}`}>{file.filename}</a></li>)}</ul>}{plan.status==="draft"&&plan.created_by===user.id?<HodPlanEditor department={selected} period={period} periodStart={start} existing={{...plan,department_plan_items:plan.department_plan_items.map((item)=>({...item,assignee_user_id:item.assignee_user_id}))}} assignees={assignees.people} assigneesReady={assignees.ready}/>:plan.status==="draft"?<p role="status">This draft predates HOD editing and has no verified author. It is left unchanged; contact an Admin to resolve the period conflict.</p>:<p className="eba-plans__notice">Submitted plans are read-only. No submitted or historical plan is overwritten.</p>}</article>)}
    </section></DashboardShell>;
  }
  const [department, label] = departments.find(([key]) => key === query.department) ?? departments[0];
  const period = periods.find((key) => key === query.period) ?? "week";
  const start = periodStart(query.date, period);
  const { data: plan, error } = await client
    .from("department_plans")
    .select("title, summary, status, department_plan_items(id,title,owner,due_date,status), department_plan_attachments(id,filename)")
    .eq("department", department)
    .eq("period_kind", period)
    .eq("period_start", start)
    .eq("status", "submitted")
    .order("due_date", { referencedTable: "department_plan_items", nullsFirst: false })
    .order("id", { referencedTable: "department_plan_items" })
    .order("filename", { referencedTable: "department_plan_attachments" })
    .maybeSingle<Plan>();

  return (
    <DashboardShell
      role={role}
      section="projects"
      banner={
        <header className="eba-plans__hero">
          <p className="eba-plans__eyebrow">Projects / Planning</p>
          <h1 id="department-plans-title">Department Plans</h1>
          <p>Review submitted plans, deliverables, and files across departments.</p>
        </header>
      }
    >
      <section className="eba-plans" aria-labelledby="department-plans-title">
        <div className="eba-plans__controls">
          <p className="eba-plans__eyebrow" id="plan-departments">Departments</p>
          <nav aria-labelledby="plan-departments" className="eba-plans__tabs">
            {departments.map(([key, name]) => (
              <Link
                key={key}
                href={{ pathname: "/dashboard/projects", query: { department: key, period, date: start } }}
                aria-current={key === department ? "page" : undefined}
              >
                {name}
              </Link>
            ))}
          </nav>
          <form action="/dashboard/projects" className="eba-plans__filters" key={department + period + start}>
            <input type="hidden" name="department" value={department} />
            <label>Period
              <select name="period" defaultValue={period}>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </label>
            <label>Date within period
              <input type="date" name="date" defaultValue={start} required />
            </label>
            <button type="submit">View plan <span aria-hidden="true">→</span></button>
          </form>
        </div>
        <article className="eba-plans__card" aria-label={label + " plan"}>
          <div className="eba-plans__card-heading">
            <div>
              <p className="eba-plans__eyebrow">{label}</p>
              <h2>{plan?.title ?? "Plan overview"}</h2>
              <p className="eba-plans__date">{period === "week" ? "Week of" : period === "month" ? "Month of" : "Year of"}{" "}
                <time dateTime={start}>{new Intl.DateTimeFormat("en-GB", {
                  timeZone: "UTC",
                  year: "numeric",
                  month: period === "year" ? undefined : "long",
                  day: period === "week" ? "numeric" : undefined,
                }).format(new Date(start + "T00:00:00Z"))}</time>
              </p>
            </div>
            {plan && <span className="eba-plans__status">Submitted</span>}
          </div>
          {error ? <p role="status">Department plans could not be loaded.</p> : !plan ? (
            <div className="eba-plans__empty">
              <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h6l2 2h8a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a1 1 0 0 1 1-1zM9 14h6" />
              </svg>
              <h3>No submitted plan</h3>
              <p>There’s no plan for {label} in this period. Select another department or date to see its plan.</p>
            </div>
          ) : (
            <>
              {plan.summary && <p className="eba-plans__summary">{plan.summary}</p>}
              <h3>Tasks and deliverables</h3>
              {plan.department_plan_items.length === 0 ? <p>No tasks or deliverables.</p> : (
                <ul className="eba-plans__items">
                  {plan.department_plan_items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <dl>
                        <div><dt>Owner</dt><dd>{item.owner}</dd></div>
                        <div><dt>Due date</dt><dd>{item.due_date ?? "No due date"}</dd></div>
                        <div><dt>Status</dt><dd>{item.status}</dd></div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
              <h3>Private attachments</h3>
              {plan.department_plan_attachments.length === 0 ? <p>No attachments.</p> : (
                <ul className="eba-plans__items">
                  {plan.department_plan_attachments.map(({ id, filename }) => (
                    <li key={id}><a href={`/dashboard/projects/attachments/${id}`}>{filename}</a></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </article>
      </section>
    </DashboardShell>
  );
}
