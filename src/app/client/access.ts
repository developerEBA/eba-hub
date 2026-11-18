import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSessionClient } from "../../lib/staff-auth";
import { portalSessionCookie } from "../../lib/supabase-client";

export const portalSignIn = "/client/sign-in";
export const portalPath = "/client/portal";

export async function getPortalAccess() {
  await connection();
  const client = await createSessionClient(portalSessionCookie);
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email_confirmed_at) return null;

  const { data: clientId } = await client.rpc("current_client_portal_id");
  return typeof clientId === "string" ? { client, clientId } : null;
}

export async function requirePortalAccess() {
  const access = await getPortalAccess();
  if (!access) redirect(portalSignIn);
  return access;
}
