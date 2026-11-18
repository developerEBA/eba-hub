import type { requireDashboardAccess } from "../access";
import { PortalActionForm } from "./portal-action-form";

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

const auditLabels: Record<string, string> = {
  invite_created: "Created invitation",
  invite_revoked: "Revoked invitation",
  invite_accepted: "Accepted invitation",
  access_granted: "Restored portal access",
  access_revoked: "Revoked portal access",
  project_shared: "Shared project",
  file_shared: "Shared file",
  share_revoked: "Unshared work",
};

function ShareDetails() {
  return (
    <>
      <label>Client-facing title <input name="title" required maxLength={160} /></label>
      <label>Client-facing description <textarea name="description" maxLength={1500} rows={2} /></label>
    </>
  );
}

export async function ClientPortalManagement({ client, clientId, role, tab }: {
  client: Awaited<ReturnType<typeof requireDashboardAccess>>["client"];
  clientId: string;
  role: "CEO" | "Admin";
  tab: "access" | "work" | "activity";
}) {
  const admin = role === "Admin";
  const empty = { data: [], error: null };
  const [invites, access, shares, audit, projects] = await Promise.all([
    tab !== "work" ? client.from("client_portal_invites").select("id,email,expires_at,used_at,revoked_at")
      .eq("client_id", clientId).order("created_at", { ascending: false }) : empty,
    tab !== "work" ? client.from("client_portal_access").select("user_id,email,revoked_at").eq("client_id", clientId) : empty,
    tab !== "access" ? client.from("client_portal_shares").select("id,kind,title,revoked_at,created_at").eq("client_id", clientId)
      .order("created_at", { ascending: false }) : empty,
    tab === "activity" ? client.from("client_portal_audit").select("id,actor_email,action,target_id,created_at")
      .eq("client_id", clientId).order("id", { ascending: false }).limit(50) : empty,
    admin && tab === "work" ? client.from("department_plans").select("id,title,department,period_start").eq("status", "submitted")
      .order("period_start", { ascending: false }) : null,
  ]);

  if (invites.error || access.error || shares.error || audit.error) {
    return <p role="status">Client access and sharing could not be loaded.</p>;
  }

  const names = new Map<string, string>();
  invites.data.forEach((invite) => names.set(invite.id, invite.email));
  access.data.forEach((entry) => names.set(entry.user_id, entry.email));
  shares.data.forEach((share) => names.set(share.id, share.title));

  return (
    <>
      {tab === "access" && <section className="eba-client-management" aria-labelledby="client-access">
        <h2 id="client-access">Access</h2>
        {admin && <details>
          <summary>Create invitation</summary>
          <PortalActionForm clientId={clientId} operation="invite_created" label="Create 48-hour invitation">
            <label>Invited email <input type="email" name="email" required maxLength={254} /></label>
            <p>The recipient signs in with a verified account for this email.</p>
          </PortalActionForm>
        </details>}
        <h3>Invitations</h3>
        {!invites.data.length && <p>No invitations yet.</p>}
        <ul>{invites.data.map((invite) => {
          const status = invite.used_at ? "Accepted" : invite.revoked_at ? "Revoked"
            : new Date(invite.expires_at) <= new Date() ? "Expired" : "Pending";
          return (
            <li key={invite.id}>
              <strong>{invite.email}</strong> · {status} · Expires {dateTime.format(new Date(invite.expires_at))}
              {admin && status === "Pending" && <PortalActionForm clientId={clientId} operation="invite_revoked" label="Revoke invitation">
                <input type="hidden" name="id" value={invite.id} />
              </PortalActionForm>}
            </li>
          );
        })}</ul>
        <h3>Portal accounts</h3>
        {!access.data.length && <p>No accounts have accepted an invitation yet.</p>}
        <ul>{access.data.map((entry) => (
          <li key={entry.user_id}>
            <strong>{entry.email}</strong> · {entry.revoked_at ? "Revoked" : "Active"}
            {admin && <PortalActionForm clientId={clientId}
              operation={entry.revoked_at ? "access_granted" : "access_revoked"}
              label={entry.revoked_at ? "Grant access again" : "Revoke access"}>
              <input type="hidden" name="id" value={entry.user_id} />
              <input type="hidden" name="email" value={entry.email} />
            </PortalActionForm>}
          </li>
        ))}</ul>
      </section>}
      {tab === "work" && <section className="eba-client-management" aria-labelledby="client-shared-work">
        <h2 id="client-shared-work">Shared work</h2>
        <p>Manage the projects and files available to this client.</p>
        {admin && <>
          <details>
            <summary>Share a submitted project</summary>
            {projects?.error ? <p>Projects could not be loaded.</p> : projects?.data?.length ? (
              <PortalActionForm clientId={clientId} operation="project_shared" label="Share project">
                <label>Department plan
                  <select name="id" required defaultValue="">
                    <option value="">Choose a submitted plan</option>
                    {projects.data.map((project) => <option key={project.id} value={project.id}>
                      {project.title} · {project.department} · {project.period_start}
                    </option>)}
                  </select>
                </label>
                <ShareDetails />
              </PortalActionForm>
            ) : <p>No submitted plans are available to share.</p>}
          </details>
          <details>
            <summary>Upload and share a file</summary>
            <PortalActionForm clientId={clientId} operation="file_shared" label="Upload and share">
              <label>PDF, JPEG, or PNG (up to 750 KB)
                <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required />
              </label>
              <ShareDetails />
            </PortalActionForm>
          </details>
        </>}
        {!shares.data.length && <p>No work has been shared yet.</p>}
        <ul className="eba-client-workspace__shares">{shares.data.map((share) => (
          <li key={share.id}>
            <div><strong>{share.title}</strong><small>{share.kind === "file" ? "File" : "Project"}</small></div>
            <time dateTime={share.created_at}>{dateTime.format(new Date(share.created_at))}</time>
            <span className="eba-client-workspace__status">{share.revoked_at ? "Unshared" : "Shared"}</span>
            {admin && !share.revoked_at && <PortalActionForm clientId={clientId} operation="share_revoked" label="Unshare">
              <input type="hidden" name="id" value={share.id} />
            </PortalActionForm>}
          </li>
        ))}</ul>
      </section>}
      {tab === "activity" && <section className="eba-client-management" aria-labelledby="client-activity">
        <h2 id="client-activity">Portal activity</h2>
        {!audit.data.length && <p>No portal activity yet.</p>}
        <ul>{audit.data.map((entry) => (
          <li key={entry.id}>
            {auditLabels[entry.action] ?? entry.action} · {names.get(entry.target_id) ?? "Portal record"} · {entry.actor_email ?? "Hub account"} · {dateTime.format(new Date(entry.created_at))}
          </li>
        ))}</ul>
      </section>}
    </>
  );
}
