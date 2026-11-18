import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isClientId } from "../../../dashboard/clients/directory";
import { portalPath, requirePortalAccess } from "../../access";
import { PortalShell } from "../portal-shell";

export default function SharedItem({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p role="status">Loading shared work…</p>}><Detail params={params} /></Suspense>;
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const access = await requirePortalAccess();
  const { client, clientId } = access;
  const { id } = await params;
  if (!isClientId(id)) notFound();
  const { data } = await client.from("client_portal_shares").select("id,kind,title,description,filename")
    .eq("client_id", clientId).eq("id", id).is("revoked_at", null).maybeSingle();
  if (!data) notFound();

  return (
    <PortalShell access={access}>
      <Link href={portalPath}>← Shared Work</Link>
      <h1>{data.title}</h1>
      {data.description && <p className="eba-client-portal__description">{data.description}</p>}
      {data.kind === "file" && <a href={portalPath + "/files/" + id}>Download {data.filename}</a>}
    </PortalShell>
  );
}
