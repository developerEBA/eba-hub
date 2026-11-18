import { Suspense } from "react";
import { requireDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import DashboardLoading from "../loading";
import { GoogleConnectionCard } from "./google-connection-card";
import { notices, type Notice } from "../../../lib/google-organizer/server";
import "./settings.css";

async function SettingsContent({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { role } = await requireDashboardAccess();
  const { google } = await searchParams;
  // Success is established by the authenticated status endpoint, never a URL flag.
  const message = google && google !== "connected" && Object.hasOwn(notices, google) ? notices[google as Notice] : undefined;
  return <DashboardShell role={role} section="settings">
    <section className="eba-settings" aria-labelledby="settings-title">
      <p className="eba-settings__eyebrow">Workspace preferences</p>
      <h1 id="settings-title">Settings</h1>
      <p>Keep your team’s tools connected and ready.</p>
      <GoogleConnectionCard role={role} message={message}/>
    </section>
  </DashboardShell>;
}
export default function SettingsPage(props: { searchParams: Promise<{ google?: string }> }) {
  return <Suspense fallback={<DashboardLoading/>}><SettingsContent {...props}/></Suspense>;
}
