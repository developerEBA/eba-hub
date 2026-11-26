import { Suspense } from "react";
import { requireHodDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import DashboardLoading from "../loading";
import { GoogleConnectionCard } from "./google-connection-card";
import { notices, type Notice } from "../../../lib/google-organizer/server";
import "./settings.css";
import {StaffAccessCard} from "./staff-access-card";
import "./staff-access.css";
import { AccountProfileForm } from "../../account/profile/profile-form";
import "../../account/profile/profile.css";

async function SettingsContent({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { role } = await requireHodDashboardAccess();
  const { google } = await searchParams;

  const message = google && google !== "connected" && Object.hasOwn(notices, google) ? notices[google as Notice] : undefined;
  return <DashboardShell role={role} section="settings">
    <section className="eba-settings" aria-labelledby="settings-title">
      <p className="eba-settings__eyebrow">Workspace preferences</p>
      <h1 id="settings-title">Settings</h1>
      <p>{role === "HOD" ? "Manage your personal workspace profile." : "Keep your team’s tools connected and ready."}</p>
      <AccountProfileForm/>
      {role !== "HOD" && <><GoogleConnectionCard role={role} message={message}/><StaffAccessCard role={role}/></>}
    </section>
  </DashboardShell>;
}
export default function SettingsPage(props: { searchParams: Promise<{ google?: string }> }) {
  return <Suspense fallback={<DashboardLoading/>}><SettingsContent {...props}/></Suspense>;
}
