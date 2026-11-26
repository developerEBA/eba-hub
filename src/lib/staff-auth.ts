import { cookies } from "next/headers";
import { createSupabaseClient, staffSessionCookie } from "./supabase-client";

export async function createStaffClient() {
  return createSessionClient(staffSessionCookie);
}

export async function createSessionClient(cookieName: string) {
  const store = await cookies();

  return createSupabaseClient({
    getAll: () => store.getAll(),
    setAll(entries) {
      try {
        for (const { name, value, options } of entries) store.set(name, value, options);
      } catch {
        // Server Components cannot write cookies. The dashboard proxy refreshes them.
      }
    },
  }, cookieName);
}

export async function clearStaffSession(
  client: NonNullable<Awaited<ReturnType<typeof createStaffClient>>>,
  cookieName = staffSessionCookie,
) {
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // Local cleanup still runs if the auth service is unavailable.
  } finally {
    // Clear local cookies even if the auth service cannot revoke the session.
    const store = await cookies();
    for (const { name } of store.getAll()) {
      if (name === cookieName || name.startsWith(cookieName + ".")) {
        store.delete(name);
      }
    }
  }
}

export async function getStaffRole(
  client: NonNullable<Awaited<ReturnType<typeof createStaffClient>>>,
  user: { id: string; email?: string },
): Promise<"CEO" | "Admin" | null> {
  if (!user.email || !/^[^@]+@enibrand\.com$/i.test(user.email)) return null;

  const { data, error } = await client
    .from("staff_memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error || (data?.role !== "ceo" && data?.role !== "admin")) return null;
  return data.role === "ceo" ? "CEO" : "Admin";
}

export type ActiveAccountRole = "CEO" | "Admin" | "Employee" | "HOD";
export type DashboardRole = "CEO" | "Admin" | "HOD";

// Active employees/HODs may use the isolated account-profile page only.
// Dashboard authorization continues to use getStaffRole above.
export async function getActiveAccountRole(
  client: NonNullable<Awaited<ReturnType<typeof createStaffClient>>>,
  user: { id: string; email?: string },
): Promise<ActiveAccountRole | null> {
  if (!user.email || !/^[^@]+@enibrand\.com$/i.test(user.email)) return null;
  const { data, error } = await client.from("staff_memberships").select("role")
    .eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (error) return null;
  return ({ ceo: "CEO", admin: "Admin", staff: "Employee", hod: "HOD" } as const)[data?.role as "ceo" | "admin" | "staff" | "hod"] ?? null;
}

// HOD dashboard access is deliberately separate from executive authorization.
// Callers opt into it only on the HOD-capable workspace surfaces; management
// routes continue to use getStaffRole and therefore remain CEO/Admin-only.
export async function getHodDashboardAccess(
  client: NonNullable<Awaited<ReturnType<typeof createStaffClient>>>,
  user: { id: string; email?: string; email_confirmed_at?: string | null },
) {
  if (!user.email || !user.email_confirmed_at || !/^[^@]+@enibrand\.com$/i.test(user.email)) return null;
  const { data: membership, error: membershipError } = await client.from("staff_memberships")
    .select("role,status").eq("user_id", user.id).eq("role", "hod").eq("status", "active").maybeSingle();
  if (membershipError || !membership) return null;
  const { data: assignments, error: assignmentsError } = await client.from("staff_department_assignments")
    .select("department").eq("user_id", user.id).order("department");
  const departments = [...new Set((assignments ?? []).map((row) => row.department).filter((value): value is string =>
    ["graphics", "development", "communications", "events", "marketing"].includes(value)))];
  if (assignmentsError || departments.length === 0) return null;
  return { role: "HOD" as const, departments };
}
