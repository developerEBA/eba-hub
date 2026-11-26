"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardNavigation, navigationForRole } from "../navigation";

type Kind = "welcome" | "approvals" | "meetings" | "pages" | "help";
type Approval = { id?: string; title: string; request_type: string; department: string; submitted_at: string };
type Meeting = { id: string; title: string; starts_at: string; ends_at: string };

const approvalLabels: Record<string, string> = {
  graphics: "Graphics design", marketing: "Marketing campaign", website: "Website review",
  leave: "Leave request", sick: "Sick notice", absence: "Absence notice",
};

const navigationHelp: Record<(typeof dashboardNavigation)[number]["key"], string> = {
  overview: "Your dashboard overview and workspace summary.",
  projects: "Browse current project plans and their progress.",
  approvals: "Review pending requests and submissions. Decisions are made on that protected page.",
  connect: "Open the staff messaging workspace. Private chats are not read by this helper.",
  calendar: "View authorized meetings. Join controls appear only when their protected eligibility check allows them.",
  announcements: "Manage announcements and open recipient history. Drafts and author-only actions keep their access rules.",
  clients: "Browse the client workspace and its protected records.",
  insights: "Review monthly Employee of the Month, Best Teamwork and Most Improved Employee awards. CEO and Admin nominate and review independently; reviews stay private until both submit and agree. Only an active CEO can publish. Activity statistics are unavailable until work tracking records verified contributors and completion dates.",
  games: "Open the workspace games area.",
  settings: "Manage workspace settings. Only an Admin can change staff access or manage the Google connection.",
};

export function EbaAssistant({ role }: { role: "CEO" | "Admin" | "HOD" }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Kind>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [approvals, setApprovals] = useState<{ count: number | null; items: Approval[] } | null>(null);
  const [meetings, setMeetings] = useState<{ items: Meeting[]; truncated: boolean } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    const check = () => setBlocked(Boolean(document.querySelector(
      'dialog[open]:not([data-eba-assistant]),[role="dialog"][aria-modal="true"],[data-announcement-block="true"]',
    )));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "aria-modal", "data-announcement-block"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !blocked && !node.open) { node.showModal(); closeButton.current?.focus(); }
    if ((!open || blocked) && node.open) node.close();
  }, [open, blocked]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const restore = () => {
      if (open) {
        setOpen(false);
        window.requestAnimationFrame(() => launcher.current?.focus());
      }
    };
    node.addEventListener("close", restore);
    return () => node.removeEventListener("close", restore);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => launcher.current?.focus());
  }, []);

  const load = useCallback(async (kind: "approvals" | "meetings") => {
    const token = ++generation.current;
    setView(kind); setLoading(true); setError("");
    try {
      const response = await fetch(`/dashboard/assistant/api?kind=${kind}`, { cache: "no-store", headers: { Accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "This information could not be loaded. Try again.");
      if (token !== generation.current) return;
      if (kind === "approvals") setApprovals({ count: Number.isInteger(body.count) ? body.count : null, items: Array.isArray(body.items) ? body.items : [] });
      else setMeetings({ items: Array.isArray(body.meetings) ? body.meetings : [], truncated: Boolean(body.truncated) });
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : "This information could not be loaded. Try again.");
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, []);

  const openPanel = () => { if (blocked) return; setView("welcome"); setError(""); setOpen(true); };
  const showView = (next: Kind) => { setError(""); setView(next); };
  const date = (value: string) => new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  return <>
    {!blocked && <button ref={launcher} type="button" className="eba-assistant-launcher" aria-label="EBA Assistant" onClick={openPanel}>
      <Image className="eba-assistant-launcher__robot" src="/images/eba-assistant-robot.png" alt="" aria-hidden="true" width={352} height={352} priority />
      <span className="eba-assistant-launcher__label" aria-hidden="true">EBA Assistant</span>
    </button>}
    <dialog ref={dialog} className="eba-assistant" data-eba-assistant aria-labelledby="eba-assistant-title" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) close(); }}>
      <header className="eba-assistant__header"><div><span className="eba-assistant__eyebrow">EBA HUB · GUIDED HELP</span><h2 id="eba-assistant-title">EBA Assistant</h2></div><button ref={closeButton} type="button" aria-label="Close EBA Assistant" onClick={close}>×</button></header>
      <div className="eba-assistant__body" aria-live="polite" aria-busy={loading}>
        {view !== "welcome" && <button type="button" className="eba-assistant__back" onClick={() => showView("welcome")}>← Back to help</button>}
        {view === "welcome" && <><p className="eba-assistant__welcome">Hello! What would you like help with?</p><div className="eba-assistant__choices">
          <button type="button" onClick={() => void load("approvals")}>Pending approvals <span>›</span></button>
          <button type="button" onClick={() => void load("meetings")}>Upcoming meetings <span>›</span></button>
          <button type="button" onClick={() => showView("pages")}>Find a page <span>›</span></button>
          <button type="button" onClick={() => showView("help")}>How to use EBA Hub <span>›</span></button>
        </div></>}
        {view === "approvals" && <section><h3>{role === "HOD" ? "Assigned department approvals" : "Pending approvals"}</h3>{loading ? <p role="status">Checking the current queue…</p> : error ? <div className="eba-assistant__notice" role="alert"><p>{error}</p><button type="button" onClick={() => void load("approvals")}>Retry</button></div> : approvals && <><p>{approvals.count === null ? "Count unavailable" : `${approvals.count} pending ${approvals.count === 1 ? "item" : "items"}`}</p>{approvals.items.length ? <ul className="eba-assistant__results">{approvals.items.map((item) => <li key={`${item.id ?? "department"}:${item.department}:${item.submitted_at}`}><Link href={item.id ? `/dashboard/approvals?request=${encodeURIComponent(item.id)}` : "/dashboard/approvals"} onClick={close}><strong>{item.title}</strong><span>{approvalLabels[item.request_type] ?? "Request"} · {item.department} · {date(item.submitted_at)}</span></Link></li>)}</ul> : <p>{role === "HOD" ? "No pending approvals in your assigned departments." : "No pending approvals."}</p>}<button type="button" className="eba-assistant__refresh" onClick={() => void load("approvals")}>Refresh queue</button><Link className="eba-assistant__text-link" href="/dashboard/approvals" onClick={close}>Open Approvals</Link></>}</section>}
        {view === "meetings" && <section><h3>Upcoming meetings</h3>{loading ? <p role="status">Checking your current calendar…</p> : error ? <div className="eba-assistant__notice" role="alert"><p>{error}</p><button type="button" onClick={() => void load("meetings")}>Retry</button></div> : meetings && <>{meetings.items.length ? <ul className="eba-assistant__results">{meetings.items.map((item) => <li key={item.id}><Link href={`/dashboard/calendar?meeting=${encodeURIComponent(item.id)}`} onClick={close}><strong>{item.title}</strong><span>{date(item.starts_at)} · Lagos time</span></Link></li>)}</ul> : <p>No upcoming meetings are available to you.</p>}{meetings.truncated && <p>Showing the next 5 meetings.</p>}<p className="eba-assistant__hint">Open a meeting in Calendar to see its current Join controls.</p><button type="button" className="eba-assistant__refresh" onClick={() => void load("meetings")}>Refresh meetings</button><Link className="eba-assistant__text-link" href="/dashboard/calendar" onClick={close}>Open Calendar</Link></>}</section>}
        {view === "pages" && <section><h3>Find a page</h3><ul className="eba-assistant__pages">{navigationForRole(role).map((item) => <li key={item.key}><Link href={item.href} onClick={close}><strong>{item.label}</strong><span>{navigationHelp[item.key]}</span></Link></li>)}</ul>{role !== "HOD" && <Link className="eba-assistant__text-link" href="/dashboard/insights?archive=recognition" onClick={close}>Read-only historical recognition archive</Link>}</section>}
        {view === "help" && <section><h3>How to use EBA Hub</h3><ul className="eba-assistant__help"><li>{role === "HOD" ? "Use the dashboard navigation for your assigned department workspace. Employee dashboards are not released." : "Use the dashboard navigation to open pages available to active CEO and Admin accounts. Employee dashboards are not released."}</li><li>Only Admin can change staff access. For monthly recognition, active CEO and Admin nominate and review independently; reviews remain private until both submit and agree, and only an active CEO can publish.</li><li>Employee of the Month requires documented contribution, beneficiaries, outcomes and evidence. Best Teamwork requires at least two eligible contributors, documented collaboration and shared outcomes. Most Improved Employee requires dated before-and-after evidence within that month.</li><li>Activity statistics are unavailable because work tracking does not record verified contributors or completion dates.</li><li>Calendar meetings are shown only when visible to your account. Join eligibility is rechecked by Calendar.</li><li>This helper is read-only. It does not change records, read private chats or send email.</li></ul></section>}
      </div>
      <footer className="eba-assistant__footer"><button type="button" onClick={() => showView("welcome")}>Help home</button><span>Quick workspace guidance · read-only</span></footer>
    </dialog>
  </>;
}
