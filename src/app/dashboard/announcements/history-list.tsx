import Link from "next/link";
import { OverviewCard } from "../overview-card";
import { departmentNames } from "../connect/model";

export type AnnouncementHistoryEntry = {
  id: string;
  revision: number;
  title: string;
  body: string;
  audience_type: "company" | "departments";
  departments: string[];
  published_at: string;
  expires_at: string | null;
  acknowledged_at: string | null;
};

const time = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" });

export function AnnouncementHistoryPreview({ entries, error }: { entries: AnnouncementHistoryEntry[]; error: boolean }) {
  return <OverviewCard title="Announcements" action={<Link href="/dashboard/announcements/history">View all</Link>}>
    {error ? <p role="status">Authorized announcements could not be loaded.</p> : !entries.length ? <p>No current announcements for your account.</p> :
      <ul className="eba-overview__records">{entries.slice(0, 3).map((entry) => <li key={`${entry.id}:${entry.revision}`}>
        <strong>{entry.title}</strong><span>{entry.audience_type === "company" ? "Company-wide" : entry.departments.map((d) => departmentNames[d] ?? d).join(", ")} · {time.format(new Date(entry.published_at))}</span>
      </li>)}</ul>}
  </OverviewCard>;
}

export function AnnouncementHistoryList({ entries, error }: { entries: AnnouncementHistoryEntry[]; error: boolean }) {
  return <section className="eba-announcements" aria-labelledby="announcement-history-heading">
    <header className="eba-announcements__hero"><div><span className="eba-announcements__eyebrow">RECIPIENT VIEW</span><h1 id="announcement-history-heading">Announcements</h1><p>Published announcements currently available to your account.</p></div></header>
    {error ? <p role="alert">Announcements could not be loaded. Refresh to retry.</p> : !entries.length ? <p className="eba-announcements__empty">No current announcements for your account.</p> : <div className="eba-announcements__list">{entries.map((entry) =>
      <article className="eba-announcements__record" key={`${entry.id}:${entry.revision}`}>
        <div className="eba-announcements__record-heading"><h2>{entry.title}</h2><span>{entry.acknowledged_at ? "Acknowledged" : "Available"}</span></div>
        <p className="eba-announcements__body">{entry.body}</p>
        <p className="eba-announcements__meta">{entry.audience_type === "company" ? "Company-wide" : entry.departments.map((d) => departmentNames[d] ?? d).join(", ")} · Published {time.format(new Date(entry.published_at))} · Revision {entry.revision}</p>
      </article>)}</div>}
  </section>;
}
