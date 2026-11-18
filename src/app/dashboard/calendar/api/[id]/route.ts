import { calendarAuth, calendarHeaders, findMeeting, setupMessage } from "../../server";
import { uuidPattern } from "../../model";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await calendarAuth();
  if (!auth) return Response.json({ error: "Sign in with an active CEO or Admin account." }, { status: 401, headers: calendarHeaders });
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return Response.json({ error: "Meeting unavailable." }, { status: 404, headers: calendarHeaders });
  const result = await findMeeting(auth.client, auth.user.id, id,auth.role);
  if (result.error) return Response.json({ error: setupMessage }, { status: 503, headers: calendarHeaders });
  if (!result.data) return Response.json({ error: "Meeting unavailable." }, { status: 404, headers: calendarHeaders });
  return Response.json(result.data, { headers: calendarHeaders });
}
