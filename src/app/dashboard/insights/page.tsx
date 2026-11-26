import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireHodDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import DashboardLoading from "../loading";
import { recognitionPath } from "./recognition";
import { PeriodAward } from "./period-award";
import { isRecognitionPeriod, latestCompletedRecognitionPeriod, nextRecognitionPeriod, recognitionPeriodClosed, recognitionPeriodLabel, recognitionPeriodStart, type RecognitionCadence } from "./periods";
import "./insights.css";

type Query = Record<string, string | string[] | undefined>;
type AwardType = "employee_month" | "teamwork_month" | "most_improved_month";
const awardTypes: AwardType[] = ["employee_month", "teamwork_month", "most_improved_month"];
type Candidate = { user_id: string; display_name: string };
type PeriodNomination = { id: string; contributor_ids: string[]; what_they_did: string; collaboration: string; who_benefited: string; what_changed: string; evidence_date: string; evidence_url: string; before_date: string | null; after_date: string | null; before_evidence: string | null; after_evidence: string | null };
type PeriodReview = { reviewer_id: string; reviewer_role: "ceo" | "admin"; nomination_id: string | null; impact: string; contribution: string; evidence_strength: string; submitted_at: string };
type PeriodResult = { outcome: "winner" | "no_award"; result_label: string; public_reason: string };
type QueryResult<T> = { data: T | null; error: unknown };

export default function Insights({ searchParams }: { searchParams: Promise<Query> }) {
  return <Suspense fallback={<DashboardLoading />}><Recognition searchParams={searchParams} /></Suspense>;
}

async function Recognition({ searchParams }: { searchParams: Promise<Query> }) {
  const { client, role, user } = await requireHodDashboardAccess();
  if(role==="HOD")redirect("/dashboard");
  const query = await searchParams;
  if (query.archive === "recognition") {
    const [weekly, period, retiredMonthly] = await Promise.all([
      client.from("weekly_recognition").select("week_start,winner_name,reason,outcome").order("week_start",{ascending:false}).limit(50),
      client.from("period_recognition_results").select("award_type,period_start,outcome,result_label,public_reason").in("award_type",["employee_year","teamwork_year"]).order("period_start",{ascending:false}).limit(100),
      client.from("period_recognition_results").select("award_type,period_start,outcome,result_label,public_reason").in("award_type",["employee_month","teamwork_month"]).order("period_start",{ascending:false}).limit(100),
    ]);
    return <DashboardShell role={role} section="insights"><section className="eba-recognition"><header className="recognition-page-heading"><div><p className="recognition-kicker">Insights</p><h1>Historical recognition archive</h1><p>Read-only published results from retired weekly and yearly categories. New nominations and reviews are disabled.</p><Link href={recognitionPath}>Back to monthly recognition</Link></div></header><section className="period-recognition"><h2>Published historical results</h2>{weekly.error || period.error || retiredMonthly.error ? <p role="alert">Historical results could not be loaded.</p> : <ul>{[...(weekly.data??[]).map((row)=>({label:"Employee of the Week",period:row.week_start,outcome:row.outcome,name:row.winner_name,reason:row.reason})),...(period.data??[]).map((row)=>({label:row.award_type==="employee_year"?"Employee of the Year":"Best Teamwork · Year",period:row.period_start,outcome:row.outcome,name:row.result_label,reason:row.public_reason})),...(retiredMonthly.data??[]).map((row)=>({label:row.award_type==="employee_month"?"Employee of the Month":"Best Teamwork",period:row.period_start,outcome:row.outcome,name:row.result_label,reason:row.public_reason}))].map((row)=><li key={`${row.label}-${row.period}`}><strong>{row.label} · {row.period}</strong><p>{row.outcome==="no_award"?"No award published":row.name}</p><p>{row.reason}</p></li>)}</ul>}{!weekly.data?.length&&!period.data?.length&&!retiredMonthly.data?.length&&!weekly.error&&!period.error&&!retiredMonthly.error&&<p>No historical published results.</p>}</section></section></DashboardShell>;
  }
  const cadence: RecognitionCadence = "month";
  const current = recognitionPeriodStart(cadence);
  const latestCompleted = latestCompletedRecognitionPeriod();
  const period = isRecognitionPeriod(cadence, query.period) && String(query.period) <= current ? query.period : latestCompleted;
  const types = awardTypes;
  const candidateQuery = client.rpc("period_recognition_candidates").returns<Candidate[]>();
  const combined = await Promise.all([candidateQuery, ...types.map((type) => Promise.all([
    client.from("period_recognition_nominations").select("id,contributor_ids,what_they_did,collaboration,who_benefited,what_changed,evidence_date,evidence_url,before_date,after_date,before_evidence,after_evidence").eq("award_type",type).eq("period_start",period).order("submitted_at").returns<PeriodNomination[]>(),
    client.from("period_recognition_reviews").select("reviewer_id,reviewer_role,nomination_id,impact,contribution,evidence_strength,submitted_at").eq("award_type",type).eq("period_start",period).returns<PeriodReview[]>(),
    client.from("period_recognition_results").select("outcome,result_label,public_reason").eq("award_type",type).eq("period_start",period).maybeSingle<PeriodResult>(),
  ]) )]);
  const candidatesResult = combined[0] as QueryResult<Candidate[]>;
  const awards = combined.slice(1) as [QueryResult<PeriodNomination[]>,QueryResult<PeriodReview[]>,QueryResult<PeriodResult>][];
  const candidates = candidatesResult.data ?? [];
  const periodClosed = recognitionPeriodClosed(cadence,period);
  return <DashboardShell role={role} section="insights"><section className="eba-recognition" aria-labelledby="recognition-title">
    <RecognitionHeader cadence={cadence} period={period} current={current}/>
    <section className="period-recognition" aria-labelledby="period-recognition-heading"><header><div><p className="recognition-kicker">Recognition</p><h2 id="period-recognition-heading">Monthly evidence awards</h2><p>Each award uses evidence from the selected month, with Africa/Lagos period boundaries.</p></div></header>
      {!periodClosed && <p className="period-recognition__notice"><strong>Period in progress.</strong> This month is open for viewing; nominations and reviews become available after the month closes.</p>}
      <div className="period-recognition__grid">{types.map((type,index) => {
        const [nominations,reviews,result] = awards[index];
        return <PeriodAward key={type} type={type} period={period} periodClosed={periodClosed} candidates={candidates}
          nominations={nominations.data ?? []} reviews={reviews.data ?? []} result={result.data ?? null} role={role} userId={user.id}
          unavailable={Boolean(nominations.error || reviews.error || result.error)} candidateUnavailable={Boolean(candidatesResult.error)}/>;
      })}</div>
    </section>
    <ActivitySection cadence={cadence} period={period}/>
  </section></DashboardShell>;
}

function RecognitionHeader({ cadence, period, current }: { cadence: RecognitionCadence; period: string; current: string }) {
  const mostRecentCompleted = latestCompletedRecognitionPeriod();
  const previous = nextRecognitionPeriod(cadence,period,-1), next = nextRecognitionPeriod(cadence,period,1);
  return <header className="recognition-page-heading"><div><p className="recognition-kicker">Insights</p><h1 id="recognition-title">Employee Recognition</h1><p className="recognition-subtitle">Admin and CEO nominate and review. CEO publishes the agreed result.</p>
    <nav className="period-recognition__tabs" aria-label="Recognition month"><Link href={{pathname:recognitionPath,query:{cadence:"month",period:mostRecentCompleted}}} aria-current={period===mostRecentCompleted?"page":undefined}>Most recent completed</Link><Link href={{pathname:recognitionPath,query:{cadence:"month",period:current}}} aria-current={period===current?"page":undefined}>Current month</Link></nav>
  </div><nav className="recognition-week" aria-label={`${cadence} navigation`}>
    <Link aria-label={`Previous ${cadence}`} href={{pathname:recognitionPath,query:{cadence,period:previous}}}>‹</Link>
    <div><strong>{recognitionPeriodLabel(cadence,period)}</strong>{period===current?<span>Current period</span>:<Link href={{pathname:recognitionPath,query:{cadence,period:current}}}>Back to current</Link>}</div>
    {next<=current?<Link aria-label={`Next ${cadence}`} href={{pathname:recognitionPath,query:{cadence,period:next}}}>›</Link>:<span aria-hidden="true" className="recognition-week__disabled">›</span>}
  </nav></header>;
}

function ActivitySection({ cadence, period }: { cadence: RecognitionCadence; period: string }) { return <section className="period-recognition__activity" aria-labelledby="activity-heading"><p className="recognition-kicker">Activity · {recognitionPeriodLabel(cadence,period)} · Africa/Lagos</p><h2 id="activity-heading">Work activity</h2><p>Activity statistics will be available when work tracking is connected.</p><small>Historical plan items have free-text owners and no verified contributor IDs or completion timestamps. New HOD-authored tasks record verified assignee IDs, assignment times, and HOD-reported completion times, but a status change is not independently verified and this view does not yet calculate metrics. Submitted plans, uploads, approvals, edits and deletions are not completion evidence. Reporting needs an auditable status history and defined treatment of reopened or duplicate completions.</small></section>; }
