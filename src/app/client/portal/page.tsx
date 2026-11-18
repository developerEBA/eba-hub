import Link from "next/link";
import { Suspense } from "react";
import { portalPath, requirePortalAccess } from "../access";
import { PortalShell } from "./portal-shell";

export default function ClientPortal() {
  return <Suspense fallback={<p role="status">Loading shared work…</p>}><SharedWork /></Suspense>;
}

async function SharedWork() {
  const access = await requirePortalAccess();
  const { client, clientId } = access;
  const { data, error } = await client.from("client_portal_shares").select("id,kind,title")
    .eq("client_id", clientId).is("revoked_at", null).order("created_at", { ascending: false });

  return (
    <PortalShell access={access}>
      <h1>Shared Work</h1>
      {error ? <p role="status">Shared work could not be loaded.</p> : data.length ? (
        <ul>{data.map((share) => <li key={share.id}>
          <Link prefetch={false} href={portalPath + "/" + share.id}>{share.title}</Link>
          <span>{share.kind === "file" ? "File" : "Project"}</span>
        </li>)}</ul>
      ) : <p>No work has been shared with you yet</p>}
    </PortalShell>
  );
}
