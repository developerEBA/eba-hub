import { calendarAuth, calendarHeaders, findMeeting } from "../../../server";
import { uuidPattern } from "../../../model";
import { retryOccurrence, runCalendarSync } from "../../../../../../lib/calendar-google/worker";
export const maxDuration = 120;
export async function POST(request: Request,{ params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Forbidden" },{ status: 403,headers: calendarHeaders });
  const auth = await calendarAuth();
  if (!auth) return Response.json({ error: "Sign in with an active CEO or Admin account." },{ status: 401,headers: calendarHeaders });
  const { id } = await params;
  if (!uuidPattern.test(id)) return Response.json({ error: "Meeting unavailable." },{ status: 404,headers: calendarHeaders });
  const found = await findMeeting(auth.client,auth.user.id,id,auth.role);
  if (found.error) return Response.json({ error: "Calendar setup is unavailable." },{ status: 503,headers: calendarHeaders });
  if (!found.data || found.data.organizer_id !== auth.user.id) return Response.json({ error: "Meeting unavailable or you are not its organizer." },{ status: 404,headers: calendarHeaders });
  if (found.data.source === "google") return Response.json({error:"This meeting is managed in Google Calendar."},{status:409,headers:calendarHeaders});
  try {
    if (!await retryOccurrence(id,auth.user.id)) throw new Error("Retry unavailable");
    await runCalendarSync(id);
    return Response.json({ message: "Meeting preparation checked. Refresh the details for its current status." },{ headers: calendarHeaders });
  } catch { return Response.json({ error: "Meeting is saved locally. Preparation could not finish; check Google setup and retry." },{ status: 503,headers: calendarHeaders }); }
}
