import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createStaffClient, getHodDashboardAccess, getStaffRole } from "../../../lib/staff-auth";
import { departmentLabels, viewRange, type CalendarView, type Directory, type Meeting, type MeetingPerson, type Person } from "./model";

const legacyMeetingColumns = "id,series_id,organizer_id,ordinal,original_starts_at,title,agenda,starts_at,ends_at,timezone,frequency,recurrence_until,attendee_ids,department_targets,status,version,join_url,sync_status,recording_status,link_error_code";
const sourceMeetingColumns=legacyMeetingColumns+",source";
const audienceMeetingColumns=sourceMeetingColumns+",audience,audience_version";
export const meetingColumns = audienceMeetingColumns+",joining_closed_at,call_end_status";
const missingSource = (error: {code:string;message:string}|null) => !!error && ["42703","PGRST204"].includes(error.code) && /source|audience|joining_closed_at|call_end_status/.test(error.message);
export const calendarHeaders = { "Cache-Control": "private, no-store" };
export const setupMessage = "Calendar setup pending. Confirm the Calendar Part 1 and Part 2 migrations.";
export function calendarAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
export async function calendarAuth() {
  const client = await createStaffClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const role = await getStaffRole(client, data.user);
  if (role) return { client, user: data.user, role, departments: [] as string[] };
  const hod = await getHodDashboardAccess(client, data.user);
  return hod ? { client, user: data.user, role: hod.role, departments: hod.departments } : null;
}
type StaffClient = NonNullable<Awaited<ReturnType<typeof createStaffClient>>>;
export async function loadMeetings(client: StaffClient, userId: string, view: CalendarView = "week", limit = 200,role?:"CEO"|"Admin"|"HOD") {
  const range = viewRange(view);


  const queryFor = (columns:string) => {
  let query = client.from("calendar_occurrences").select(columns);
  if(role!=="CEO"&&role!=="Admin")query=query.or(`organizer_id.eq.${userId},attendee_ids.cs.{${userId}}`);


  query=query.eq("status", "scheduled").gt("ends_at", range.from);
  if (view !== "upcoming") query = query.lt("starts_at", range.to);
  return query.order("starts_at").order("id").limit(limit + 1).overrideTypes<Meeting[],{merge:false}>();
  };
  let result = await queryFor(meetingColumns);
  if (missingSource(result.error)) result = await queryFor(audienceMeetingColumns);
  if (missingSource(result.error)) result = await queryFor(sourceMeetingColumns);
  if (missingSource(result.error)) result = await queryFor(legacyMeetingColumns);
  return { meetings: (result.data ?? []).slice(0, limit) as Meeting[], truncated: (result.data?.length ?? 0) > limit, ready: !result.error, error: result.error ? setupMessage : null };
}
export async function findMeeting(client: StaffClient, userId: string, id: string,role?:"CEO"|"Admin"|"HOD") {
  const queryFor = (columns:string) => {
    let query=client.from("calendar_occurrences").select(columns).eq("id",id);
    if(role!=="CEO"&&role!=="Admin")query=query.or(`organizer_id.eq.${userId},attendee_ids.cs.{${userId}}`);
    return query.maybeSingle().overrideTypes<Meeting|null,{merge:false}>();
  };
  let result = await queryFor(meetingColumns);
  if(missingSource(result.error))result=await queryFor(audienceMeetingColumns);
  if(missingSource(result.error))result=await queryFor(sourceMeetingColumns);
  return missingSource(result.error) ? await queryFor(legacyMeetingColumns) : result;
}


export async function loadMeetingPeople(client:StaffClient,meetings:Meeting[]):Promise<MeetingPerson[]> {
  const ids=[...new Set(meetings.flatMap(m=>[m.organizer_id,...m.attendee_ids]))].slice(0,100);
  if(!ids.length)return [];
  try{
    const result=await client.from("connect_profiles").select("user_id,display_name,avatar_url").in("user_id",ids)
      .limit(100).abortSignal(AbortSignal.timeout(2000)).overrideTypes<MeetingPerson[],{merge:false}>();
    return result.error?[]:result.data??[];
  }catch{return []}
}
export async function loadDirectory(role?: "CEO"|"Admin"|"HOD", allowedDepartments: string[] = []): Promise<Directory> {
  const admin = calendarAdmin();
  if (!admin) return { people: [], requiredParticipants: [], departments: [], ready: false };
  const roles = ["ceo","admin","hod"];
  const memberships = await admin.from("staff_memberships").select("user_id,role").eq("status", "active").in("role", roles).order("user_id").limit(500);
  if (memberships.error) return { people: [], requiredParticipants: [], departments: [], ready: false };
  const ids = (memberships.data ?? []).map((person) => person.user_id);
  const batches = [];
  for (let offset=0; offset<ids.length; offset+=100) batches.push(ids.slice(offset,offset+100));
  const lookups = await Promise.all(batches.map((batch) => Promise.all([
    admin.from("connect_profiles").select("user_id,display_name").in("user_id", batch),
    admin.from("staff_department_assignments").select("user_id,department").in("user_id", batch),
  ])));
  if (lookups.some(([profiles,assignments]) => profiles.error || assignments.error)) return { people: [], requiredParticipants: [], departments: [], ready: false };
  const names = new Map(lookups.flatMap(([profiles]) => profiles.data ?? []).map((profile) => [profile.user_id, profile.display_name]));
  const assignments = lookups.flatMap(([,response]) => response.data ?? []);
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) return { people: [], requiredParticipants: [], departments: [], ready: false };
  const verified = new Set(users.data.users.filter((user) => user.email && /^[^@]+@enibrand\.com$/i.test(user.email)
    && user.email_confirmed_at && !user.deleted_at && (!user.banned_until || new Date(user.banned_until) <= new Date())).map((user) => user.id));
  let eligibleAssignments = role === "HOD" ? assignments.filter((row) => allowedDepartments.includes(row.department)) : assignments;
  eligibleAssignments = eligibleAssignments.filter((row) => verified.has(row.user_id));
  const eligibleIds = new Set(eligibleAssignments.map((row) => row.user_id));
  const people = (memberships.data ?? []).map((person) => ({ user_id: person.user_id, role: person.role,
    display_name: names.get(person.user_id) ?? `${person.role.toUpperCase()} · ${person.user_id.slice(0,6)}`,
    departments: eligibleAssignments.filter((row) => row.user_id === person.user_id).map((row) => row.department),
  })).filter((person) => verified.has(person.user_id) && (person.role === "ceo" || person.role === "admin"
    || (role === "HOD" && eligibleIds.has(person.user_id)))) as Person[];
  const requiredParticipants = (memberships.data ?? []).map((person) => ({ user_id: person.user_id, role: person.role,
    display_name: names.get(person.user_id) ?? `${person.role.toUpperCase()} · ${person.user_id.slice(0,6)}`,
    departments: assignments.filter((row) => row.user_id === person.user_id).map((row) => row.department),
  })).filter((person) => verified.has(person.user_id) && (person.role === "ceo" || person.role === "admin"
    || (person.role === "hod" && assignments.some((row) => row.user_id === person.user_id && row.department === "communications")))) as Person[];
  const departments = Object.entries(departmentLabels).map(([id,label]) => ({ id, label, count: people.filter((person) => person.departments.includes(id)).length })).filter((department) => department.count > 0);
  return { people, requiredParticipants, departments, ready: true };
}
