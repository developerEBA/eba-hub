import "server-only";
import { calendarAdmin } from "../calendar/server";

export type PlanAssignee = { user_id: string; display_name: string; department: string };

export async function loadPlanAssignees(departments: string[]): Promise<{ ready: boolean; people: PlanAssignee[] }> {
  const admin = calendarAdmin();
  if (!admin || !departments.length) return { ready: false, people: [] };
  const assignments = await admin.from("staff_department_assignments").select("user_id,department")
    .in("department", departments).limit(1000);
  if (assignments.error) return { ready: false, people: [] };
  const scoped = assignments.data ?? [];
  const ids = [...new Set(scoped.map((row) => row.user_id))];
  if (!ids.length) return { ready: true, people: [] };
  const memberships = await admin.from("staff_memberships").select("user_id,role").eq("status", "active")
    .in("role", ["staff", "hod"]).in("user_id", ids).limit(1000);
  if (memberships.error) return { ready: false, people: [] };
  const users = [];
  for (let page = 1; page <= 5; page++) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) return { ready: false, people: [] };
    users.push(...result.data.users);
    if (result.data.users.length < 1000) break;
  }
  const verifiedIds = new Set(users.filter((user) => user.email && /^[^@]+@enibrand\.com$/i.test(user.email)
    && user.email_confirmed_at && !user.deleted_at && (!user.banned_until || new Date(user.banned_until) <= new Date()))
    .map((user) => user.id));
  const activeIds = (memberships.data ?? []).map((row) => row.user_id).filter((id) => verifiedIds.has(id));
  if (!activeIds.length) return { ready: true, people: [] };
  const profiles = await admin.from("connect_profiles").select("user_id,display_name").in("user_id", activeIds).limit(1000);
  if (profiles.error) return { ready: false, people: [] };
  return { ready: true, people: scoped.filter((row) => activeIds.includes(row.user_id)).flatMap((row) => {
    const profile = profiles.data?.find((entry) => entry.user_id === row.user_id);
    return profile?.display_name ? [{ user_id: row.user_id, display_name: profile.display_name, department: row.department }] : [];
  }) };
}
