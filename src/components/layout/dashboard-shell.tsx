"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bell,
  MessageSquareMore,
  Search,
  ChevronDown,
  Menu,
  X,
} from "lucide-react";
import { dashboardNavigation } from "@/modules/dashboard/navigation";
import { signOut } from "@/modules/auth/actions";
import type { Counts } from "@/modules/operations/types";
export type DashboardHeader = {
  displayName: string;
  role: string;
  ready: boolean;
  counts: Counts | null;
};
export function DashboardShell({
  children,
  header,
}: {
  children: React.ReactNode;
  header: DashboardHeader;
}) {
  const [mobile, setMobile] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<
      { title: string; href: string; kind: string }[]
    >([]),
    [searchStatus, setSearchStatus] = useState("");
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) {
          setResults([]);
          setSearchStatus(data.error ?? "Search unavailable.");
          return;
        }
        setResults(data.results);
        setSearchStatus(
          data.results.length ? "" : "No accessible records match your search.",
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSearchStatus("Search could not be completed.");
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const badge = (label: string) =>
    label === "EBA Connect"
      ? header.counts?.messages
      : label === "Approvals"
        ? header.counts?.approvals
        : label === "Notifications"
          ? header.counts?.notifications
          : null;
  return (
    <div className="reference-shell">
      <a href="#reference-main" className="skip-link">
        Skip to dashboard
      </a>
      {mobile && (
        <button
          className="ref-overlay"
          aria-label="Close navigation overlay"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={`ref-sidebar ${mobile ? "is-open" : ""}`}
        aria-label="Dashboard navigation"
      >
        <Link href="/dashboard" className="ref-brand">
          <span>
            <b>EBA</b> Hub
          </span>
          <small>ENI BRAND ARCHITECT</small>
        </Link>
        <button
          className="ref-mobile-close"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        >
          <X />
        </button>
        <nav>
          {dashboardNavigation.map(({ label, href, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className={href === "/dashboard" ? "active" : ""}
              aria-current={href === "/dashboard" ? "page" : undefined}
              onClick={() => setMobile(false)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {!!badge(label) && <i>{badge(label)}</i>}
            </Link>
          ))}
        </nav>
        <div className="ref-brand-quote">
          <div className="ref-gold-lines" />
          <p>
            “People
            <br /> Ideas
            <br /> Reputation
            <br /> Impact
          </p>
          <small>— ENI BRAND ARCHITECT</small>
        </div>
      </aside>
      <div className="ref-workspace">
        <header className="ref-topbar">
          <button
            className="ref-mobile-toggle"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu />
          </button>
          <div className="ref-search">
            <Search size={18} />
            <input
              type="search"
              aria-label="Search projects, people, files and messages"
              placeholder="Search for projects, people, files, messages..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setResults([]);
                setSearchStatus(
                  e.target.value.trim().length >= 2
                    ? "Searching…"
                    : "Enter at least two characters.",
                );
              }}
            />
            {query && (
              <div className="ref-search-results">
                <p role="status">{searchStatus}</p>
                {results.map((r, index) => (
                  <Link key={`${r.href}-${index}`} href={r.href}>
                    {r.kind} · {r.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <span className="ref-demo-label">
            {header.ready ? "WORKSPACE" : "SETUP REQUIRED"}
          </span>
          <Link
            className="ref-header-icon"
            href="/dashboard/notifications"
            aria-label="Notifications"
          >
            <Bell />
            {!!header.counts?.notifications && (
              <i>{header.counts.notifications}</i>
            )}
          </Link>
          <Link
            className="ref-header-icon"
            href="/dashboard/chat"
            aria-label="Open EBA Connect messages"
          >
            <MessageSquareMore />
          </Link>
          <details className="ref-user">
            <summary>
              <span className="ref-user-initial" aria-hidden="true">
                {header.ready
                  ? header.displayName.slice(0, 1).toUpperCase()
                  : "E"}
              </span>
              <span>
                <strong>{header.displayName}</strong>
                <small>
                  {header.role.replaceAll("_", " ") || "Database not connected"}
                </small>
              </span>
              <ChevronDown size={17} />
            </summary>
            <div>
              <Link href="/dashboard/settings">Profile and settings</Link>
              <Link href="/login">Sign-in information</Link>
              <form action={signOut}>
                <button>Sign out</button>
              </form>
            </div>
          </details>
        </header>
        <main id="reference-main" className="ref-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
