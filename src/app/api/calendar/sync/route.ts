import { createHash, timingSafeEqual } from "node:crypto";
import { runCalendarSync } from "../../../../lib/calendar-google/worker";
import { privateHeaders } from "../../../../lib/google-organizer/server";
import { runCalendarReminders } from "../../../../lib/calendar-reminders/server";
import { runCalendarCycle } from "../../../../lib/calendar-reminders/cycle";
import { runGoogleImport } from "../../../../lib/calendar-google/import";
import { runCallEnding } from "../../../../lib/calendar-google/call-ending";

export const maxDuration = 120;
function authorized(request: Request) {
  const secret = process.env.CALENDAR_SYNC_SECRET;
  if (!secret || secret.length<32 || secret === "YOUR_RANDOM_SERVER_ONLY_WORKER_SECRET") return false;
  const provided = request.headers.get("authorization") ?? "";
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(provided),digest(`Bearer ${secret}`));
}
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Forbidden" }, { status: 403,headers: privateHeaders });
  try {
    const callEnding=await runCallEnding();
    let imported={available:false,imported:0};
    const {syncFailed,...result}=await runCalendarCycle(async()=>{
      imported=await runGoogleImport();
      return await runCalendarSync(undefined,45_000);
    },runCalendarReminders);
    const data={...result,google_import:imported,call_ending:callEnding};
    return Response.json(syncFailed ? {...data,error:"Google synchronization is unavailable. Reminder processing was attempted independently."}:data,
      {status:syncFailed?503:200,headers:privateHeaders});
  }
  catch { return Response.json({ error: "Calendar synchronization is unavailable. Check worker and migration setup." },{ status: 503,headers: privateHeaders }); }
}
// Supports authenticated cron services that invoke GET. No browser session can
// substitute for the independent server-only worker secret.
export const GET = POST;
