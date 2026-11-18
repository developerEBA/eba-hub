import { calendarAdmin, calendarAuth, calendarHeaders, findMeeting, loadDirectory, loadMeetings, loadMeetingPeople, setupMessage } from "../server";
import { uuidPattern, validateInput, type CalendarView, type Meeting } from "../model";

export async function GET(request: Request) {
  const auth = await calendarAuth();
  if (!auth) return Response.json({ error: "Sign in with an active CEO or Admin account." }, { status: 401, headers: calendarHeaders });
  const view = new URL(request.url).searchParams.get("view");
  const result = await loadMeetings(auth.client, auth.user.id, (["week","next","upcoming","today"].includes(view ?? "") ? view : "week") as CalendarView,200,auth.role);
  if(result.ready&&view==="today"&&new URL(request.url).searchParams.get("people")==="1"){
    const people=await loadMeetingPeople(auth.client,result.meetings);
    return Response.json({...result,people},{headers:calendarHeaders});
  }
  return Response.json(result, { status: result.ready ? 200 : 503, headers: calendarHeaders });
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Request origin rejected." }, { status: 403, headers: calendarHeaders });
  const auth = await calendarAuth();
  if (!auth) return Response.json({ error: "Sign in with an active CEO or Admin account." }, { status: 401, headers: calendarHeaders });
  const admin = calendarAdmin();
  if (!admin) return Response.json({ error: "Calendar server configuration is pending." }, { status: 503, headers: calendarHeaders });
  try {
    if (Number(request.headers.get("content-length")) > 24000) throw new Error("Meeting request is too large.");
    const raw = await request.text();
    if (raw.length > 24000) throw new Error("Meeting request is too large.");
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid meeting request.");
    if (typeof body.requestId !== "string" || !uuidPattern.test(body.requestId)) throw new Error("Invalid request ID.");
    if (!["create","update","cancel"].includes(String(body.command)) || !["one","remaining"].includes(String(body.scope))) throw new Error("Invalid meeting action.");
    let existing: Meeting | null = null;
    if (body.command !== "create") {
      if (typeof body.id !== "string" || !uuidPattern.test(body.id)) throw new Error("Invalid meeting ID.");
      const found = await findMeeting(auth.client, auth.user.id, body.id,auth.role);
      if (found.error) return Response.json({ error: setupMessage }, { status: 503, headers: calendarHeaders });
      existing = found.data as Meeting | null;
      if (!existing || existing.organizer_id !== auth.user.id) return Response.json({ error: "Meeting unavailable or you are not its organizer." }, { status: 404, headers: calendarHeaders });
      if (existing.source === "google") return Response.json({error:"Edit or cancel this meeting in Google Calendar."},{status:409,headers:calendarHeaders});
      if (!Number.isInteger(body.version)) throw new Error("Refresh the meeting before making changes.");
    }
    const input = body.command === "cancel" ? null : validateInput({ ...body, ...(existing && body.scope === "one" ? { frequency: "once", until: null } : {}) });
    if (input) {
      const directory = await loadDirectory();
      if (!directory.ready) return Response.json({ error: setupMessage }, { status: 503, headers: calendarHeaders });
      if (input.attendees.some((id) => !directory.people.some((person) => person.user_id === id)) || input.departments.some((id) => !directory.departments.some((department) => department.id === id))) throw new Error("Select only active attendees and departments with real assignments.");
    }
    const { data, error } = await admin.rpc("calendar_mutate", {
      p_actor: auth.user.id, p_request: body.requestId, p_command: body.command,
      p_occurrence: existing?.id ?? null, p_scope: body.scope, p_version: existing ? body.version : null, p_payload: input ?? {},
    });
    if (error) {
      const known = /Meeting changed|call-ending check in progress|Select |Weekly end date|Keep the series|Request ID was already|This occurrence|Invalid title|department has no/i.test(error.message);
      return Response.json({ error: known ? error.message : "Calendar could not save this change. Confirm the migration and server prerequisites, then try again." }, { status: /Meeting changed|call-ending check in progress/.test(error.message) ? 409 : known ? 400 : 503, headers: calendarHeaders });
    }
    return Response.json({ id: data, message: body.command === "cancel" ? "Meeting cancelled locally. Google cancellation is queued." : "Meeting saved. Google Meet preparation is queued." }, { headers: calendarHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? "Invalid meeting request." : error instanceof Error ? error.message : "Meeting could not be saved." }, { status: 400, headers: calendarHeaders });
  }
}
