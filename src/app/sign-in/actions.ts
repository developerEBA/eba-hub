"use server";

import { redirect } from "next/navigation";
import { recordConnectSignIn } from "../../lib/connect-enrollment";
import { clearStaffSession, createStaffClient, getStaffRole } from "../../lib/staff-auth";

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

  let authorized = false;
  try {
    authorized = Boolean(await getStaffRole(client, data.user));
  } catch {
    return signInError;
  } finally {
    if (!authorized) await clearStaffSession(client);
  }

  if (!authorized) return signInError;
  try {
    await recordConnectSignIn(data.user.id);
  } catch {
    // A Connect outage should not block the rest of the staff workspace.
  }
  redirect("/dashboard");
}

export async function signOutStaff() {
  const client = await createStaffClient();
  if (client) await clearStaffSession(client);
  redirect("/sign-in");
}
