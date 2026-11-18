"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { clearStaffSession, createSessionClient } from "../../../lib/staff-auth";
import { portalSessionCookie } from "../../../lib/supabase-client";
import { portalPath, portalSignIn } from "../access";

export async function signInClient(_previous: string | null, form: FormData) {
  const email = form.get("email");
  const password = form.get("password");
  const token = form.get("invite");
  if (typeof email !== "string" || typeof password !== "string" || !password ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter your invited email and password.";
  if (token && (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))) return "This invitation is invalid.";

  const client = await createSessionClient(portalSessionCookie);
  if (!client) return "Client sign-in is unavailable.";
  const signIn = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (signIn.error || !signIn.data.user?.email_confirmed_at) {
    if (signIn.data.session) await clearStaffSession(client, portalSessionCookie);
    return "Could not sign in with this account.";
  }

  if (typeof token === "string" && token) {
    const result = await client.rpc("accept_client_portal_invite", {
      p_hash: createHash("sha256").update(token).digest("hex"),
    });
    if (result.error || !["ok", "used"].includes(result.data)) {
      await clearStaffSession(client, portalSessionCookie);
      if (result.data === "expired") return "This invitation has expired.";
      if (result.data === "revoked") return "This invitation was revoked.";
      return "This invitation cannot be accepted with this account.";
    }
    if (result.data === "used") {
      await clearStaffSession(client, portalSessionCookie);
      return "This invitation was already used. Open Client Portal sign-in without the invitation link.";
    }
  }

  const { data: clientId } = await client.rpc("current_client_portal_id");
  if (typeof clientId !== "string") {
    await clearStaffSession(client, portalSessionCookie);
    return "This account does not have active Client Portal access.";
  }
  redirect(portalPath);
}

export async function signOutClient() {
  const client = await createSessionClient(portalSessionCookie);
  if (client) await clearStaffSession(client, portalSessionCookie);
  redirect(portalSignIn);
}
