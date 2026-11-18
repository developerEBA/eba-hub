import { NavigationLink } from "./navigation-link";
import type { ReactNode } from "react";
import { EbaWordmark } from "../eba-wordmark";
import { signOutStaff } from "../sign-in/actions";
import type { requireDashboardAccess } from "./access";
import { DashboardIcon, dashboardNavigation, type DashboardSection } from "./navigation";
import { OfficeQuote } from "./office-quote";
import { NotificationBell } from "./notifications/bell";

export function DashboardShell({ role, section, banner, focus, fullScreen, children }: {
  role: Awaited<ReturnType<typeof requireDashboardAccess>>["role"];
  section: DashboardSection;
  banner?: ReactNode;
  focus?: ReactNode;
  fullScreen?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="eba-dashboard" data-section={section} data-full-screen={fullScreen || undefined}>
      <aside className="eba-dashboard__sidebar">
        <div className="eba-dashboard__brand" aria-label="EBA Hub">
          <EbaWordmark />
          <p>ENI BRAND ARCHITECT</p>
        </div>
        <nav aria-label="Dashboard">
          {dashboardNavigation.map(({ key, label, href, icon }) => (
            <NavigationLink key={key} className="eba-dashboard__overview" href={href} aria-current={section === key ? "page" : undefined}>
              <DashboardIcon path={icon} />
              {label}
            </NavigationLink>
          ))}
        </nav>
      </aside>
      <div className="eba-dashboard__workspace">
        <div className="eba-dashboard__masthead">
          <header className="eba-dashboard__topbar">
            <span>Staff workspace</span>
            <div className="eba-dashboard__account">
              <NotificationBell />
              <span className="eba-dashboard__role">{role}</span>
              <form action={signOutStaff}>
                <button type="submit">Sign out</button>
              </form>
            </div>
          </header>
          {banner && <div className="eba-dashboard__section-banner">{banner}</div>}
        </div>
        <main className="eba-dashboard__main">
          {section === "overview" && (
            <section className="eba-dashboard__banner" aria-labelledby="dashboard-welcome">
              <div className="eba-dashboard__greeting">
                <p>Staff workspace</p>
                <h1 id="dashboard-welcome">Welcome to EBA Hub</h1>
                <p>Your private staff workspace.</p>
                <OfficeQuote />
              </div>
              {focus}
            </section>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
