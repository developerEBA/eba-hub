import type { requireDashboardAccess } from "../access";

const lagosDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Lagos" });
const displayDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export const recognitionPath = "/dashboard/insights";

export function currentRecognitionWeek(now = new Date()) {
  const date = new Date(lagosDate.format(now) + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function isMonday(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return date.getUTCDay() === 1 && date.toISOString().slice(0, 10) === value;
}

export function shiftWeek(week: string, weeks: number) {
  const date = new Date(week + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

export function recognitionWeekLabel(week: string) {
  const start = new Date(week + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return displayDate.format(start) + " – " + displayDate.format(end);
}

export function loadRecognition(
  client: Awaited<ReturnType<typeof requireDashboardAccess>>["client"],
  week: string,
) {
  return client.from("weekly_recognition").select("winner_name,reason,outcome").eq("week_start", week).maybeSingle();
}

export function loadPublishedPeriodRecognition(
  client: Awaited<ReturnType<typeof requireDashboardAccess>>["client"],
  periodStart: string,
) {
  const types = ["employee_month", "teamwork_month", "most_improved_month"];
  return Promise.all(types.map((awardType) => client.from("period_recognition_results")
    .select("award_type,period_start,outcome,nomination_id,result_label,public_reason,published_at")
    .eq("award_type", awardType).eq("period_start", periodStart).maybeSingle()));
}

export type PublishedPeriodRecognition = { award_type: string; period_start: string; outcome: "winner" | "no_award"; result_label: string; public_reason: string; published_at: string };
