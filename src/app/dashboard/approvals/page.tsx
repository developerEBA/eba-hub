import { Suspense } from "react";
import DashboardLoading from "../loading";
import Link from "next/link";
import { DashboardIcon } from "../navigation";
import { DashboardShell } from "../dashboard-shell";
import { approvalStatuses, approvalTypes, isRequestId, requireApprovalsAccess } from "./review";
import { ApprovalDetail, formatTimestamp, type RequestDetail, type RequestSummary } from "./approval-detail";

const route = "/dashboard/approvals";
const listSize = 25;
const summaryFields = "id,title,request_type,department,requester_name,submitted_at,status" as const;
const tabs = [["pending", "Pending"], ["decided", "Decided"], ["all", "All requests"]] as const;
type Query = Record<string, string | string[] | undefined>;
export default function Approvals({ searchParams }: { searchParams: Promise<Query> }) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <ProtectedApprovals searchParams={searchParams} />
    </Suspense>
  );
}

async function ProtectedApprovals({ searchParams }: { searchParams: Promise<Query> }) {
  const { client, role } = await requireApprovalsAccess();
  const params = await searchParams;
  const tab = tabs.find(([key]) => key === params.tab)?.[0] ?? "pending";
  const type = Object.keys(approvalTypes).find((key) => key === params.type) ?? "";
  const page = typeof params.page === "string" && /^[1-9][0-9]{0,5}$/.test(params.page) ? Number(params.page) : 1;
  const selected = typeof params.request === "string" && isRequestId(params.request) ? params.request : undefined;
  const filters = { tab, ...(type ? { type } : {}) };
  const href = (changes: Record<string, string | number> = {}) => ({
    pathname: route,
    query: { ...filters, ...changes },
  });

  let list = client.from("approval_requests").select(summaryFields)
    .order("submitted_at", { ascending: false }).order("id")
    .range((page - 1) * listSize, page * listSize);
  if (tab === "pending") list = list.eq("status", "pending");
  if (tab === "decided") list = list.neq("status", "pending");
  if (type) list = list.eq("request_type", type);
  const detailQuery = selected ? client.from("approval_requests")
    .select(summaryFields + ",message,external_url,start_date,end_date,attachment_names,reviewer_email,decided_at,decision_note,department_plans(title,department,period_kind,period_start)")
    .eq("id", selected)
    .eq("department_plans.status", "submitted")
    .maybeSingle<RequestDetail>() : null;

  const [{ data: rows, error: listError }, detail] = await Promise.all([
    list.overrideTypes<RequestSummary[], { merge: false }>(),
    detailQuery,
  ]);

  const requests = rows?.slice(0, listSize) ?? [];
  const request = detail?.data;
  return (
    <DashboardShell role={role} section="approvals">
      <section className="eba-approvals" aria-labelledby="approvals-title" data-selected={Boolean(selected)}>
        <header className="eba-approvals__heading">
          <h1 id="approvals-title">Approvals</h1>
          <p>Review team submissions and staff requests.</p>
        </header>
        <div className="eba-approvals__toolbar">
          <nav aria-label="Request status" className="eba-approvals__tabs">
            {tabs.map(([key, label]) => (
              <Link key={key} href={href({ tab: key })} aria-current={tab === key ? "page" : undefined}>{label}</Link>
            ))}
          </nav>
          <form action={route} className="eba-approvals__filter">
            <input type="hidden" name="tab" value={tab} />
            <label className="sr-only" htmlFor="approval-type">Request type</label>
            <select key={type} id="approval-type" name="type" defaultValue={type}>
              <option value="">All request types</option>
              {Object.entries(approvalTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button type="submit">Filter</button>
          </form>
        </div>
        <div className="eba-approvals__grid">
          <section className="eba-approvals__list" aria-labelledby="approval-queue">
            <header className="eba-approvals__queue-heading"><h2 id="approval-queue">Request inbox</h2><span>{tabs.find(([key]) => key === tab)?.[1]}</span></header>
            {listError ? <p role="status">Requests could not be loaded.</p> : requests.length === 0 ? (
              <p>No {tab === "all" ? "" : tab + " "}requests match these filters.</p>
            ) : (
              <ul>
                {requests.map((item) => (
                  <li key={item.id}>
                    <Link href={href({ request: item.id, page })} aria-current={item.id === selected ? "true" : undefined} prefetch={false}>
                      <div className="eba-approvals__row-title"><strong>{item.title}</strong><span className="eba-approvals__badge" data-status={item.status}>{approvalStatuses[item.status]}</span></div>
                      <span>{approvalTypes[item.request_type]} · {item.department}</span>
                      <span>{item.requester_name} · {formatTimestamp(item.submitted_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {(page > 1 || (rows?.length ?? 0) > listSize) && (
              <nav className="eba-approvals__pages" aria-label="Request pages">
                {page > 1 && <Link href={href({ page: page - 1 })}>Previous</Link>}
                {(rows?.length ?? 0) > listSize && <Link href={href({ page: page + 1 })}>Next</Link>}
              </nav>
            )}
          </section>
          <article className="eba-approvals__detail" aria-label="Request details">
            <Link className="eba-approvals__back" href={href({ page })}>← Back to requests</Link>
            {detail?.error ? <p role="status">Request details could not be loaded.</p> : !request ? (
              <div className="eba-approvals__placeholder">
                <DashboardIcon path="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8m-8 4h6" />
                <h2>{selected ? "Request unavailable" : "Request details"}</h2>
                <p>{selected ? "Return to the inbox to open another request." : "Choose a request from the inbox to review it here."}</p>
              </div>
            ) : (
              <ApprovalDetail request={request} />
            )}
          </article>
        </div>
      </section>
    </DashboardShell>
  );
}
