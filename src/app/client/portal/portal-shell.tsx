import Link from "next/link";
import type { ReactNode } from "react";
import { portalPath, type requirePortalAccess } from "../access";
import { ClientMessageRefresh } from "../../client-conversation/composer";
import "../../client-conversation/conversation.css";
import { signOutClient } from "../sign-in/actions";
import "./portal.css";

export async function PortalShell({ children, access }: {
  children: ReactNode;
  access: Awaited<ReturnType<typeof requirePortalAccess>>;
}) {
  const { data: unread } = await access.client.rpc("client_unread_message_count", { p_client: access.clientId });
  return (
    <main className="eba-client-portal">
      <header>
        <Link href={portalPath}>EBA Hub · Client Portal</Link>
        <Link href={portalPath + "/messages"} prefetch={false}>
          Messages {Number(unread) > 0 && <span className="eba-client-chat__unread" aria-label={unread + " unread"}>{unread}</span>}
        </Link>
        <form action={signOutClient}><button type="submit">Sign out</button></form>
      </header>
      <ClientMessageRefresh />
      {children}
    </main>
  );
}
