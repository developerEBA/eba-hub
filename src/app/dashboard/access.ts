import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createStaffClient, getStaffRole } from "../../lib/staff-auth";

// Overview, Projects, and attachment downloads use the same active staff gate.
export async function requireDashboardAccess() {
  await connection();

  const client = await createStaffClient();
  if (!client) redirect("/sign-in");

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/sign-in");

  const role = await getStaffRole(client, data.user);
  if (!role) redirect("/sign-in");

  return { client, role, user: data.user };
}
