export const reminderStages = [60,10,0] as const;
export type ReminderStage = typeof reminderStages[number];
export const reminderGraceMs = 120_000;
export function reminderSchedule(startsAt: string, now: number) {
  return reminderStages.map(lead => {
    const due = +new Date(startsAt)-lead*60_000;
    return { lead, due, state: due>=now ? "scheduled" as const : "skipped" as const };
  });
}
export function mostRelevantDue<T extends { lead: number; due: number }>(jobs: T[], now: number) {
  return jobs.filter(job=>job.due<=now && job.due>=now-reminderGraceMs).sort((a,b)=>b.due-a.due || a.lead-b.lead)[0] ?? null;
}
export function reminderLabel(lead: ReminderStage, startsAt: string, now: number) {
  const age = now-(+new Date(startsAt)-lead*60_000);
  if (age<0 || age>reminderGraceMs) return lead===60 ? "1-hour reminder" : lead===10 ? "10-minute reminder" : "Start-time reminder";
  return lead===60 ? "Starts in 1 hour." : lead===10 ? "Starts in 10 minutes." : "Starts now.";
}
