import { Suspense } from "react";
import { ClientConversation } from "../../../client-conversation/conversation";
import { portalPath, requirePortalAccess } from "../../access";
import { PortalShell } from "../portal-shell";

type Props = { searchParams: Promise<{ before?: string | string[] }> };

async function Messages({ searchParams }: Props) {
  const access = await requirePortalAccess();
  const { client, clientId } = access;
  const { before } = await searchParams;
  return <PortalShell access={access}>
    <h1>Messages</h1>
    <ClientConversation client={client} clientId={clientId} side="client" canSend baseUrl={portalPath + "/messages"} before={before} />
  </PortalShell>;
}

export default function ClientMessages(props: Props) {
  return <Suspense fallback={<p role="status">Loading messages…</p>}><Messages {...props} /></Suspense>;
}
