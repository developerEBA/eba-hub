import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createStaffClient, getHodDashboardAccess, getStaffRole } from "../../lib/staff-auth";

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

// Use only from HOD-capable routes. CEO/Admin management routes continue to
// call requireDashboardAccess(), whose role check remains executive-only.
export async function requireHodDashboardAccess() {
  await connection();
  const client = await createStaffClient();
  if (!client) redirect("/sign-in");
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/sign-in");
  const executiveRole = await getStaffRole(client, data.user);
  if (executiveRole) return { client, role: executiveRole, user: data.user, departments: [] as string[] };
  const hod = await getHodDashboardAccess(client, data.user);
  if (!hod) redirect("/sign-in");
  return { client, role: hod.role, user: data.user, departments: hod.departments };
}
