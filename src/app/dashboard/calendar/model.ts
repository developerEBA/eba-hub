export const calendarTimeZone = "Africa/Lagos";
export const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
export type CalendarView = "week" | "next" | "upcoming" | "today";
export type MeetingPerson = {user_id:string;display_name:string;avatar_url:string|null};
export type Meeting = {
  joining_closed_at?:string|null;
  call_end_status?:"not_requested"|"pending"|"retry"|"ended"|"no_active_call"|"unavailable"|"shared_space"|"reconnect_required";
  end_permission?:"eligible"|"not_manager"|"foreign_owner"|"setup_required";
  audience?: "private" | "company" | "general" | "leadership" | "department";
  audience_version?: number;
  source?: "eba" | "google";
  id: string; series_id: string; organizer_id: string; ordinal: number; title: string; agenda: string | null;
  starts_at: string; ends_at: string; original_starts_at: string; timezone: string;
  frequency: "once" | "weekly"; recurrence_until: string | null; attendee_ids: string[]; department_targets: string[];
  status: "scheduled" | "cancelled"; version: number;
  join_url?: string | null; sync_status?: "pending_setup" | "pending_create" | "pending_update" | "pending_cancel" | "synced" | "error";
  recording_status?: "pending" | "configured" | "warning" | "reconnect_required";
  link_error_code?: import("./meet-model").LinkError | null;
};
export type Person = { user_id: string; display_name: string; role: "ceo" | "admin" | "staff" | "hod"; departments: string[] };
export type Directory = { people: Person[]; requiredParticipants: Person[]; departments: { id: string; label: string; count: number }[]; ready: boolean };
export type MeetingInput = { title: string; agenda: string; startsAt: string; endsAt: string; frequency: "once" | "weekly"; until: string | null; attendees: string[]; departments: string[] };
export const departmentLabels: Record<string, string> = { graphics: "Graphics", development: "Development", communications: "Communications", events: "Events", marketing: "Marketing" };

export function calendarRequestId(source: Pick<Crypto,"getRandomValues"> & { randomUUID?: () => string } = globalThis.crypto) {
  if (typeof source.randomUUID === "function") return source.randomUUID();


  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function lagosDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: calendarTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function localDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: calendarTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (name: string) => parts.find((entry) => entry.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function lagosToISO(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter a valid date and time in Africa/Lagos.");
  const parsed = new Date(value + ":00+01:00");
  if (!Number.isFinite(parsed.valueOf()) || localDateTime(parsed.toISOString()) !== value) throw new Error("Enter a valid date and time in Africa/Lagos.");
  return parsed.toISOString();
}
export function addDays(date: string, days: number) {
  const value = new Date(date + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function viewRange(view: CalendarView, now = new Date()) {
  const today = lagosDate(now), day = new Date(today + "T12:00:00Z").getUTCDay();
  const monday = addDays(today, -((day + 6) % 7));
  const start = view === "upcoming" || view === "today" ? today : addDays(monday, view === "next" ? 7 : 0);
  const end = view === "upcoming" ? addDays(today, 366) : addDays(start, view === "today" ? 1 : 7);
  return { start, end, from: view === "upcoming" ? now.toISOString() : lagosToISO(start + "T00:00"), to: lagosToISO(end + "T00:00") };
}
export function validateInput(value: Record<string, unknown>, now = new Date()): MeetingInput {
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const agenda = typeof value.agenda === "string" ? value.agenda.trim() : "";
  if (!title || title.length > 160 || agenda.length > 4000) throw new Error("Use a title of 1–160 characters and an agenda of at most 4,000 characters.");
  const startsAt = lagosToISO(value.start), endsAt = lagosToISO(value.end);
  if (new Date(startsAt) <= now || new Date(endsAt) <= new Date(startsAt) || +new Date(endsAt) - +new Date(startsAt) > 86400000) throw new Error("Choose a future start and an end after it, within 24 hours.");
  if (value.frequency !== "once" && value.frequency !== "weekly") throw new Error("Choose a one-off or weekly meeting.");
  let until: string | null = null;
  if (value.frequency === "weekly") {
    if (typeof value.until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.until)) throw new Error("Choose the last date of the weekly series.");
    lagosToISO(value.until + "T00:00");
    until = value.until;
    if (until < String(value.start).slice(0, 10) || until > addDays(String(value.start).slice(0, 10), 364)) throw new Error("The series end must be within 52 weeks of its start.");
  }
  if (!Array.isArray(value.attendees) || !value.attendees.every((id) => typeof id === "string" && uuidPattern.test(id)) || value.attendees.length > 100) throw new Error("Select valid active attendees.");
  if (!Array.isArray(value.departments) || value.departments.length > 5 || !value.departments.every((id) => typeof id === "string" && Object.prototype.hasOwnProperty.call(departmentLabels,id))) throw new Error("Select valid departments.");
  if (!value.attendees.length && !value.departments.length) throw new Error("Select at least one attendee or an assigned department.");
  return { title, agenda, startsAt, endsAt, frequency: value.frequency, until, attendees: [...new Set(value.attendees as string[])], departments: [...new Set(value.departments as string[])] };
}
export function weeklyDates(input: MeetingInput) {
  const values = [{ startsAt: input.startsAt, endsAt: input.endsAt }];
  if (input.frequency === "weekly") for (let week = 1; week <= 52; week++) {
    const startsAt = new Date(+new Date(input.startsAt) + week * 7 * 86400000).toISOString();
    if (lagosDate(new Date(startsAt)) > input.until!) break;
    values.push({ startsAt, endsAt: new Date(+new Date(input.endsAt) + week * 7 * 86400000).toISOString() });
  }
  return values;
}
export const meetingDate = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: calendarTimeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(value));
export const meetingTime = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: calendarTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
