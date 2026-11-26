import "server-only";
import { calendarAdmin } from "../../app/dashboard/calendar/server";

export type ReminderCounts = { available: boolean; delivered: number; skipped: number; checked: number; group_delivery: "pending_private_groups" };
export async function runCalendarReminders(): Promise<ReminderCounts> {
  const empty: ReminderCounts = { available:false,delivered:0,skipped:0,checked:0,group_delivery:"pending_private_groups" };
  try {
    const client=calendarAdmin();
    if (!client) return empty;

    const result=await client.rpc("calendar_deliver_reminders",{p_limit:10}).abortSignal(AbortSignal.timeout(8_000));
    const data=result.data;
    if (result.error || !data || ![data.delivered,data.skipped,data.checked].every(n=>Number.isSafeInteger(n)&&n>=0)) return empty;
    return { ...empty,available:true,delivered:data.delivered,skipped:data.skipped,checked:data.checked };
  } catch { return empty; }
}
