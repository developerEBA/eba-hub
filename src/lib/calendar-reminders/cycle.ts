import type { ReminderCounts } from "./server";
// Two bounded reminder batches surround the existing Google work. Either kind
// of failure is isolated: reminder setup cannot block Google synchronization.
export async function runCalendarCycle(sync:()=>Promise<{processed:number;recorded:number}>,remind:()=>Promise<ReminderCounts>) {
  const fallback: ReminderCounts={available:false,delivered:0,skipped:0,checked:0,group_delivery:"pending_private_groups"};
  const safeReminders=async()=>{try{return await remind()}catch{return fallback}};
  const before=await safeReminders();
  let google={processed:0,recorded:0}, syncFailed=false;
  try { google=await sync(); } catch { syncFailed=true; }
  const after=await safeReminders();
  return { ...google,syncFailed,reminders:{ ...fallback,available:before.available&&after.available,
    delivered:before.delivered+after.delivered,skipped:before.skipped+after.skipped,checked:before.checked+after.checked } };
}
