import Image from "next/image";
import Link from "next/link";
import { approvalStatuses, approvalTypes, isAttachmentName, validatedExternalUrl } from "./review";
import { ReviewActions } from "./review-actions";

type RequestType = keyof typeof approvalTypes;
export type RequestSummary = {
  id: string;
  title: string;
  request_type: RequestType;
  department: string;
  requester_name: string;
  submitted_at: string;
  status: string;
};
export type RequestDetail = RequestSummary & {
  message: string;
  external_url: string | null;
  start_date: string | null;
  end_date: string | null;
  attachment_names: string[];
  department_plans: {
    title: string;
    department: string;
    period_kind: string;
    period_start: string;
  } | null;
  reviewer_email: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
}

function fileUrl(id: string, name: string, preview = false) {
  return "/dashboard/approvals/attachments/" + id + "?name=" + encodeURIComponent(name) + (preview ? "&preview=1" : "");
}

export function ApprovalDetail({ request }: { request: RequestDetail }) {
  const externalUrl = validatedExternalUrl(request.external_url);
  const files = request.attachment_names.filter(isAttachmentName);
  const preview = request.request_type === "graphics"
    ? files.find((name) => /\.(png|jpe?g|webp|gif)$/i.test(name)) : undefined;

  return (
    <>
      <header className="eba-approvals__detail-masthead">
        <p className="eba-approvals__eyebrow">{approvalTypes[request.request_type]} · {request.department}</p>
        <div className="eba-approvals__detail-heading">
          <h2>{request.title}</h2>
          <span className="eba-approvals__badge" data-status={request.status}>{approvalStatuses[request.status]}</span>
        </div>
        <p className="eba-approvals__metadata">Submitted by <strong>{request.requester_name}</strong> · <time dateTime={request.submitted_at}>{formatTimestamp(request.submitted_at)} WAT</time></p>
      </header>
      {request.start_date && request.end_date && <p>Dates: <time>{request.start_date}</time> to <time>{request.end_date}</time></p>}
      <div className="eba-approvals__message">
        <h3>{request.request_type === "marketing" ? "Campaign brief" : request.request_type === "sick" || request.request_type === "absence" ? "Employee message" : "Submission notes"}</h3>
        <p>{request.message}</p>
      </div>
      {externalUrl && (request.request_type === "website" || request.request_type === "marketing") && (
        <a className="eba-approvals__external" href={externalUrl} target="_blank" rel="noopener noreferrer">
          {request.request_type === "website" ? "Open website ↗" : "Open supporting link ↗"}
        </a>
      )}
      {request.request_type === "website" && !externalUrl && <p>No valid HTTPS website link was supplied.</p>}
      {request.department_plans && <p>Department plan: <Link href={{ pathname: "/dashboard/projects", query: {
        department: request.department_plans.department, period: request.department_plans.period_kind, date: request.department_plans.period_start,
      } }}>{request.department_plans.title}</Link></p>}
      {preview && (
        <Image className="eba-approvals__preview" src={fileUrl(request.id, preview, true)}
          alt="Submitted design preview" width={900} height={360} unoptimized />
      )}
      {files.length > 0 && (
        <ul className="eba-approvals__files" aria-label="Private attachments">
          {files.map((name) => (
            <li key={name}><span>{name}</span><a href={fileUrl(request.id, name)}>Download</a></li>
          ))}
        </ul>
      )}
      {request.decided_at && (
        <div className="eba-approvals__decision">
          <strong>{approvalStatuses[request.status]}</strong>
          <p>Reviewed by {request.reviewer_email} · {formatTimestamp(request.decided_at)} WAT</p>
          {request.decision_note && <p>{request.decision_note}</p>}
        </div>
      )}
      <ReviewActions key={request.id} id={request.id} canDecide={request.status === "pending"} />
    </>
  );
}
