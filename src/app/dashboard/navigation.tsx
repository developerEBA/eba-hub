export const dashboardNavigation = [
  { key: "overview", label: "Overview", href: "/dashboard", icon: "m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7" },
  { key: "projects", label: "Projects", href: "/dashboard/projects", icon: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
  { key: "approvals", label: "Approvals", href: "/dashboard/approvals", icon: "M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11M8 12l4 4 9-10" },
  { key: "connect", label: "Connect", href: "/dashboard/connect", icon: "M21 4H3v13h4v4l5-4h9zM7 9h10M7 13h6" },
  { key: "calendar", label: "Calendar", href: "/dashboard/calendar", icon: "M4 6h16v15H4zM8 3v6M16 3v6M4 11h16" },
  { key: "clients", label: "Clients", href: "/dashboard/clients", icon: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" },
  { key: "insights", label: "Insights", href: "/dashboard/insights", icon: "M3 4v16h18M8 16v-4M13 16V8M18 16V5" },
  { key: "games", label: "Games", href: "/dashboard/games", icon: "M7 7h10a4 4 0 0 1 4 4l1 5a2 2 0 0 1-3 2l-3-3H8l-3 3a2 2 0 0 1-3-2l1-5a4 4 0 0 1 4-4zM8 10v4M6 12h4M16 11h.01M18 13h.01" },
  { key: "settings", label: "Settings", href: "/dashboard/settings", icon: "M4 6h16M4 12h16M4 18h16M8 4v4M15 10v4M10 16v4" },
] as const;

export type DashboardSection = (typeof dashboardNavigation)[number]["key"];

export function DashboardIcon({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}
