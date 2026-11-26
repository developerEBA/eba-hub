"use client";
import { useEffect, useState } from "react";
import type { GoogleStatus } from "../../../lib/google-organizer/server";

const labels = { setup_required: "Setup required", unavailable: "Status unavailable", disconnected: "Disconnected", connected: "Connected", revoked: "Reconnect required", verification_failed: "Unable to verify access" };
async function readStatus(signal?: AbortSignal): Promise<GoogleStatus> {
  try {
    const response = await fetch("/api/google/status", { cache: "no-store", signal });
    if (!response.ok) return { state: "unavailable", email: null, meetSupported: null, verifiedAt: null, revocationFailed: false, diagnosticCode: response.status === 403 ? "GOOGLE_STATUS_FORBIDDEN" : "GOOGLE_STATUS_REQUEST_FAILED" };
    const status = await response.json() as GoogleStatus;
    if (!status || !["setup_required", "unavailable", "disconnected", "connected", "revoked", "verification_failed"].includes(status.state)) {
      return { state: "unavailable", email: null, meetSupported: null, verifiedAt: null, revocationFailed: false, diagnosticCode: "GOOGLE_STATUS_INVALID_RESPONSE" };
    }
    return status;
  } catch {
    return { state: "unavailable", email: null, meetSupported: null, verifiedAt: null, revocationFailed: false, diagnosticCode: "GOOGLE_STATUS_REQUEST_FAILED" };
  }
}
export function GoogleConnectionCard({ role, message }: { role: "CEO" | "Admin"; message?: string }) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void readStatus(controller.signal).then(value => {
      if (!controller.signal.aborted) { setStatus(value); setChecking(false); }
    });
    return () => controller.abort();
  }, []);
  const connected = status?.state === "connected";
  const organizerAccount = status?.email ?? (checking ? "Checking…" : status?.state === "disconnected" ? "No connected account" : status?.state === "setup_required" ? "Not checked until server setup is complete" : status?.state === "unavailable" ? `Lookup failed${status.diagnosticCode ? ` (${status.diagnosticCode})` : ""}` : "Account details unavailable");
  return <article className="eba-google" aria-labelledby="google-title">
    <header><span className="eba-google__icon" aria-hidden="true">31</span><div><p className="eba-settings__eyebrow">Workspace integration</p><h2 id="google-title">Google Calendar &amp; Meet</h2></div>
      <span className="eba-google__status" data-connected={connected && !checking}>{checking ? "Checking connection…" : status ? labels[status.state] : "Status unavailable"}</span>
    </header>
    <p>One organizer account for your team’s Calendar and Meet connection.</p>
    {message && <p className="eba-google__notice" role="status">{message}</p>}
    <dl><div><dt>Organizer account</dt><dd>{organizerAccount}</dd></div>
      <div><dt>Meet conferencing</dt><dd>{checking ? "Checking…" : connected ? status.meetSupported ? "Supported on the primary calendar" : "Not available on the primary calendar" : "Not verified"}</dd></div>
      <div><dt>Last verified</dt><dd>{status?.verifiedAt ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(status.verifiedAt)) + " (Lagos)" : "Not yet verified"}</dd></div></dl>
    {status?.state === "setup_required" && <div><p>Server setup is incomplete. The stored connection was not checked.</p>{status.missingVariables?.length ? <p>Missing server configuration: {status.missingVariables.join(", ")}.</p> : status.diagnosticCode && <p>Setup check: {status.diagnosticCode}.</p>}</div>}
    {status?.state === "unavailable" && <p role="status">Connection lookup is unavailable{status.diagnosticCode ? ` (${status.diagnosticCode})` : ""}. No account state was inferred from this failure.</p>}
    {status?.state === "verification_failed" && <p>Credentials were saved, but current Google access could not be confirmed. Retry the check or reconnect.</p>}
    {status?.state === "revoked" && <p>Google offline access is no longer valid. An Admin must reconnect the organizer.</p>}
    {status?.revocationFailed && <p role="status">Local access is disabled. Google revocation was not confirmed; remove EBA Hub from the organizer’s Google account permissions.</p>}
    <aside className="eba-google__readiness"><strong>Recording readiness</strong><p>Business Standard and recording permission are enabled for your organization. Automatic recording still requires an eligible host or co-host to join on the web. Authorization does not guarantee a recording.</p><p>This setup only checks the connection. Meetings and recordings are not created here.</p></aside>
    <aside className="eba-google__readiness"><strong>Required meeting participants</strong><p>Events organized by this connected account can be updated to invite active verified CEOs, Admins and the currently assigned Communications HOD. External-organizer events are not imported or changed. Ask their organizer to invite the required EBA participants; an invitation does not guarantee admission if that organizer restricts access.</p></aside>
    <footer>
      {role === "Admin" ? <><form action="/api/google/connect" method="post" onSubmit={() => setPending(true)}><button className="eba-google__primary" disabled={pending || checking || status?.state === "setup_required"}>{pending ? "Please wait…" : status?.email ? "Reconnect organizer" : "Connect organizer"}</button></form>
        <form action="/api/google/disconnect" method="post" onSubmit={() => setPending(true)}><button disabled={pending || checking || (!status?.email && status?.state !== "setup_required")} type="submit">Disconnect</button></form></> : <p>Only active Admins can manage this connection.</p>}
      <button type="button" disabled={checking || pending} onClick={() => { setChecking(true); void readStatus().then(setStatus).finally(() => setChecking(false)); }}>Reload status</button>
    </footer>
  </article>;
}
