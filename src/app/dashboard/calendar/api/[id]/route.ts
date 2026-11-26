import { calendarAuth, calendarHeaders, findMeeting, setupMessage } from "../../server";
import { uuidPattern } from "../../model";
import { endPermission } from "../../../../../lib/calendar-google/end-permission";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await calendarAuth();
  if (!auth) return Response.json({ error: "Sign in with an active CEO or Admin account." }, { status: 401, headers: calendarHeaders });
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return Response.json({ error: "Meeting unavailable." }, { status: 404, headers: calendarHeaders });
  const result = await findMeeting(auth.client, auth.user.id, id,auth.role);
  if (result.error) return Response.json({ error: setupMessage }, { status: 503, headers: calendarHeaders });
  if (!result.data) return Response.json({ error: "Meeting unavailable." }, { status: 404, headers: calendarHeaders });
  if(new URL(_request.url).searchParams.get("view")==="join"){
    const {id,starts_at,ends_at,status,joining_closed_at}=result.data;
    return Response.json({id,starts_at,ends_at,status,joining_closed_at},{headers:calendarHeaders});
  }
  const end_permission=auth.role==="Admin"?await endPermission(id,auth.user.id):"not_manager";
  return Response.json({...result.data,end_permission}, { headers: calendarHeaders });
}
