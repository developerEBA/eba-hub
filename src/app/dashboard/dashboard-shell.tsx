import { NavigationLink } from "./navigation-link";
import type { ReactNode } from "react";
import { EbaWordmark } from "../eba-wordmark";
import { signOutStaff } from "../sign-in/actions";
import { DashboardIcon, navigationForRole, type DashboardSection } from "./navigation";
import { OfficeQuote } from "./office-quote";
import { NotificationBell } from "./notifications/bell";
import { AnnouncementPrompt } from "./announcements/prompt";
import { EbaAssistant } from "./assistant/assistant";
import Image from "next/image";
import { accountActor, profileAdmin, profilePhotoPath } from "../../lib/account-profile/server";

async function DashboardAccount({ role }: { role: "CEO" | "Admin" | "HOD" }) {
  const actor = await accountActor();
  let name = "";
  let avatar: string | null = null;
  if (actor && actor.role === role) {
    const admin = profileAdmin();
    if (admin) {
      const { data } = await admin.from("connect_profiles").select("display_name,avatar_url").eq("user_id", actor.user.id).maybeSingle();
      name = data?.display_name?.trim() ?? "";
      if (data?.avatar_url === profilePhotoPath(actor.user.id)) avatar = data.avatar_url;
    }
    name ||= typeof actor.user.user_metadata?.full_name === "string" ? actor.user.user_metadata.full_name.trim() : "";
    name ||= typeof actor.user.user_metadata?.name === "string" ? actor.user.user_metadata.name.trim() : "";
  }
  return <>
    <span className="eba-dashboard__identity">
      {avatar ? <Image className="eba-dashboard__avatar" src={avatar} alt="" width={34} height={34} unoptimized/> : <span className="eba-dashboard__avatar eba-dashboard__avatar--initials" aria-hidden="true">{(name || "My account").trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>}
      <span className="eba-dashboard__identity-labels">
        <span className="eba-dashboard__display-name">{name || "My account"}</span>
        <span className="eba-dashboard__role">{role}</span>
      </span>
    </span>
    <form action={signOutStaff}><button type="submit">Sign out</button></form>
  </>;
}

export function DashboardShell({ role, section, banner, focus, fullScreen, children }: {
  role: "CEO" | "Admin" | "HOD";
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
          {navigationForRole(role).map(({ key, label, href, icon }) => (
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
            <span>EBA Hub</span>
            <div className="eba-dashboard__account">
              <NotificationBell role={role}/>
              <DashboardAccount role={role}/>
            </div>
          </header>
          {banner && <div className="eba-dashboard__section-banner">{banner}</div>}
        </div>
        <main className="eba-dashboard__main">
          {section === "overview" && (
            <section className="eba-dashboard__banner" aria-labelledby="dashboard-welcome">
              <div className="eba-dashboard__greeting">
                <p>EBA HUB</p>
                <h1 id="dashboard-welcome">Welcome to EBA Hub</h1>
                <p>Your workspace, at a glance.</p>
                <OfficeQuote />
              </div>
              {focus}
            </section>
          )}
          {children}
        </main>
      </div>
      <AnnouncementPrompt />
      <EbaAssistant role={role}/>
    </div>
  );
}
