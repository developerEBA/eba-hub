"use server";

import { redirect } from "next/navigation";
import { recordConnectSignIn } from "../../lib/connect-enrollment";
import { clearStaffSession, createStaffClient, getActiveAccountRole } from "../../lib/staff-auth";

const signInError = "Unable to sign in. Check your credentials and try again.";

export async function signInStaff(_previous: string | null, form: FormData) {
  const username = form.get("username");
  const password = form.get("password");

  if (typeof username !== "string" || typeof password !== "string" || !password) return signInError;

  const prefix = username.trim().toLowerCase();
  if (prefix.length > 64 || !/^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*$/.test(prefix)) {
    return signInError;
  }

  const client = await createStaffClient();
  if (!client) return signInError;

  const { data, error } = await client.auth.signInWithPassword({
    email: prefix + "@enibrand.com",
    password,
  });
  if (error || !data.session || !data.user) return signInError;

  let accountRole: Awaited<ReturnType<typeof getActiveAccountRole>> = null;
  try {
    accountRole = await getActiveAccountRole(client, data.user);
  } catch {
    return signInError;
  } finally {
    if (!accountRole) await clearStaffSession(client);
  }

  if (!accountRole) return signInError;
  try {
    await recordConnectSignIn(data.user.id);
  } catch {
    // A Connect outage should not block the rest of the staff workspace.
  }
  redirect(accountRole === "Employee" ? "/account/profile" : "/dashboard");
}

export async function signOutStaff() {
  const client = await createStaffClient();
  if (client) await clearStaffSession(client);
  redirect("/sign-in");
}
