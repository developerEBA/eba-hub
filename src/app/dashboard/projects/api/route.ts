import { requireHodDashboardAccess } from "../../access";
import { periodStart } from "../period";
import { loadPlanAssignees } from "../assignees";
import { uuidPattern } from "../../calendar/model";

const headers = { "Cache-Control": "private, no-store" };
const periods = ["week", "month", "year"] as const;

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Request origin rejected." }, { status: 403, headers });
  try {
    const { client, role, departments } = await requireHodDashboardAccess();
    if (role !== "HOD") return Response.json({ error: "HOD plan editor unavailable." }, { status: 403, headers });
    if (Number(request.headers.get("content-length")) > 30000) throw new Error("Plan request too large.");
    const raw = await request.text();
    if (raw.length > 30000) throw new Error("Plan request too large.");
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (typeof body.requestId !== "string" || !uuidPattern.test(body.requestId)) throw new Error("Invalid request ID.");
    if (typeof body.department !== "string" || !departments.includes(body.department)) throw new Error("Choose a currently assigned department.");
    if (typeof body.period !== "string" || !periods.includes(body.period as (typeof periods)[number])) throw new Error("Choose a supported period.");
    if (typeof body.periodStart !== "string" || periodStart(body.periodStart, body.period as (typeof periods)[number]) !== body.periodStart) throw new Error("Choose a valid period start date.");
    if (body.planId !== null && (typeof body.planId !== "string" || !uuidPattern.test(body.planId))) throw new Error("Invalid plan.");
    if (body.expectedVersion !== null && (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1)) throw new Error("Refresh the plan before saving.");
    if (typeof body.title !== "string" || body.title.length > 160 || typeof body.summary !== "string" || body.summary.length > 4000) throw new Error("Check the title and summary lengths.");
    if (!Array.isArray(body.items) || body.items.length > 50) throw new Error("A plan can contain up to 50 work items.");
    const items = body.items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid work item.");
      const task = item as Record<string, unknown>;
      if (task.id !== undefined && task.id !== null && (typeof task.id !== "string" || !uuidPattern.test(task.id))) throw new Error("Invalid work item ID.");
      if (typeof task.title !== "string" || task.title.length > 160 || typeof task.assignee_user_id !== "string" || !uuidPattern.test(task.assignee_user_id)) throw new Error("Each work item needs a title and a real assigned person.");
      if (task.due_date !== null && task.due_date !== undefined && (typeof task.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(task.due_date))) throw new Error("Invalid work item due date.");
      if (!(["not_started", "in_progress", "blocked", "completed"] as unknown[]).includes(task.status)) throw new Error("Choose a supported task status.");
      return { id: task.id ?? null, title: task.title, assignee_user_id: task.assignee_user_id, due_date: task.due_date ?? null, status: task.status };
    });
    const eligible=await loadPlanAssignees([body.department]);
    if(!eligible.ready)return Response.json({error:"Assigned member list is unavailable. Retry after checking workspace setup."},{status:503,headers});
    const eligibleIds=new Set(eligible.people.map((person)=>person.user_id));
    if(items.some((item)=>!eligibleIds.has(item.assignee_user_id)))throw new Error("Assign work only to an active verified person currently assigned to this department.");
    const result = await client.rpc("hod_department_plan_save", {
      p_request: body.requestId, p_department: body.department, p_period_kind: body.period, p_period_start: body.periodStart,
      p_plan_id: body.planId, p_expected_version: body.expectedVersion, p_title: body.title, p_summary: body.summary,
      p_items: items, p_submit: body.submit === true,
    });
    if (result.error) {
      const known = /Assigned HOD|draft|changed|Request ID|department|work item|period|title|assig|eligible|assigned/i.test(result.error.message);
      return Response.json({ error: known ? result.error.message : "Plan could not be saved. Retry after checking the migration." }, { status: known ? 409 : 503, headers });
    }
    return Response.json(result.data, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Plan could not be saved." }, { status: 400, headers });
  }
}
