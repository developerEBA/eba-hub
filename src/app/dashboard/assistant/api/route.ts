import { createStaffClient, getHodDashboardAccess, getStaffRole } from "../../../../lib/staff-auth";
import { loadMeetings } from "../../calendar/server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const unavailable = (message = "This information could not be loaded. Try again.") =>
  Response.json({ error: message }, { status: 503, headers });

export async function GET(request: Request) {
  const client = await createStaffClient();
  if (!client) return Response.json({ error: "Sign in with an active dashboard account." }, { status: 401, headers });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return Response.json({ error: "Sign in with an active dashboard account." }, { status: 401, headers });
  const executiveRole = await getStaffRole(client, data.user);
  const hod = executiveRole ? null : await getHodDashboardAccess(client, data.user);
  const role = executiveRole ?? hod?.role;
  if (!role) return Response.json({ error: "Active CEO, Admin or assigned HOD access is required." }, { status: 403, headers });

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "approvals") {
    if (role === "HOD") {
      const result = await client.rpc("hod_department_approval_summary");
      if (result.error || !result.data || typeof result.data !== "object") return unavailable("Assigned department approvals are unavailable right now.");
      const summary = result.data as { pending_count?: unknown; items?: unknown };
      const count = typeof summary.pending_count === "number" && Number.isInteger(summary.pending_count) && summary.pending_count >= 0 ? summary.pending_count : null;
      const rows = Array.isArray(summary.items) ? summary.items : [];
      const items = rows.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const row = value as Record<string, unknown>;
        if (typeof row.request_type !== "string" || typeof row.department !== "string" || typeof row.submitted_at !== "string") return [];
        return [{ title: row.request_type, request_type: row.request_type, department: row.department, submitted_at: row.submitted_at }];
      });
      return Response.json({ kind, count, items }, { headers });
    }
    const result = await client.from("approval_requests").select("id,title,request_type,department,submitted_at,status", { count: "exact" })
      .eq("status", "pending").order("submitted_at", { ascending: true }).order("id").limit(5);
    if (result.error) return unavailable("Pending approvals are unavailable right now.");
    return Response.json({ kind, count: result.count, items: result.data ?? [] }, { headers });
  }
  if (kind === "meetings") {
    const result = await loadMeetings(client, data.user.id, "upcoming", 5, role);
    if (!result.ready) return unavailable("Upcoming meetings are unavailable right now.");
    const meetings = result.meetings.map((meeting) => ({ id: meeting.id, title: meeting.title, starts_at: meeting.starts_at, ends_at: meeting.ends_at }));
    return Response.json({ kind, meetings, truncated: result.truncated }, { headers });
  }
  return Response.json({ error: "Choose a supported assistant action." }, { status: 400, headers });
}
