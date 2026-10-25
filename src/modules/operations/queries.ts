import "server-only";
import { cache } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceSession } from "@/modules/auth/server";
import type * as T from "./types";
const countSchema = z.object({
  projects: z.number(),
  tasks: z.number(),
  meetings: z.number(),
  messages: z.number(),
  notifications: z.number(),
  approvals: z.number(),
});
export const loadWorkspace = cache(async () => {
  const session = await requireWorkspaceSession();
  const empty = {
    now: new Date().toISOString(),
    ready: false,
    error: "Supabase setup required. No live records are available.",
    session,
    employees: [] as T.Employee[],
    departments: [] as { id: string; name: string }[],
    projects: [] as T.Project[],
    tasks: [] as T.Task[],
    conversations: [] as T.Conversation[],
    meetings: [] as T.Meeting[],
    approvals: [] as T.Approval[],
    focus: [] as T.Focus[],
    notifications: [] as T.Notification[],
    announcements: [] as T.Announcement[],
    recognition: [] as T.Recognition[],
    files: [] as T.FileRecord[],
    periods: [] as T.Period[],
    activity: [] as { id: string; event: string; created_at: string }[],
    reminders: [] as {
      id: string;
      state: string;
      run_at: string;
      attempts: number;
    }[],
    unread: [] as { id: string; unread_count: number }[],
    progress: [] as {
      project_id: string;
      total: number;
      completed: number;
      progress: number;
    }[],
    counts: null as T.Counts | null,
  };
  if (session.preview) return empty;
  const db = await createClient();
  const results = await Promise.all([
    db
      .from("employee_profiles")
      .select("id,display_name,role")
      .eq("is_active", true)
      .order("display_name")
      .limit(200),
    db.from("departments").select("id,name").order("name").limit(100),
    db
      .from("projects")
      .select("id,name,department_id,status,deadline,created_by")
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("tasks")
      .select(
        "id,project_id,title,assignee_id,created_by,status,priority,due_at",
      )
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("conversations")
      .select("id,title,kind")
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("meetings")
      .select(
        "id,title,organizer_id,starts_at,ends_at,meet_url,google_event_id",
      )
      .order("starts_at")
      .limit(200),
    db
      .from("approvals")
      .select("id,requester_id,title,body,status,kind,reviewer_id,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("focus_items")
      .select("id,title,complete")
      .order("created_at")
      .limit(100),
    db
      .from("notifications")
      .select("id,title,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("announcements")
      .select("id,title,body,author_id,created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("recognition")
      .select("id,recipient_id,sender_id,message,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("workspace_files")
      .select("id,name,mime_type,size_bytes,path,conversation_id")
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("award_periods")
      .select("id,title,starts_on,ends_on")
      .order("starts_on", { ascending: false })
      .limit(30),
    db
      .from("activity_events")
      .select("id,event,created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    db
      .from("reminder_jobs")
      .select("id,state,run_at,attempts")
      .order("run_at", { ascending: false })
      .limit(100),
    db.rpc("workspace_counts"),
    db
      .from("project_delivery")
      .select("project_id,total,completed,progress")
      .limit(200),
    db.from("conversation_delivery").select("id,unread_count").limit(100),
  ]);
  if (results.some((result) => result.error))
    return {
      ...empty,
      error:
        "Database setup or access failed. Apply the reviewed migrations and check your membership. No fabricated records are substituted.",
    };
  const [
    employees,
    departments,
    projects,
    tasks,
    conversations,
    meetings,
    approvals,
    focus,
    notifications,
    announcements,
    recognition,
    files,
    periods,
    activity,
    reminders,
    counts,
    progress,
    unread,
  ] = results;
  const parsed = countSchema.safeParse(counts.data);
  if (!parsed.success)
    return {
      ...empty,
      error: "The dashboard count contract is unavailable. Check migrations.",
    };
  return {
    ...empty,
    ready: true,
    error: "",
    employees: employees.data as T.Employee[],
    departments: departments.data as { id: string; name: string }[],
    projects: projects.data as T.Project[],
    tasks: tasks.data as T.Task[],
    conversations: conversations.data as T.Conversation[],
    meetings: meetings.data as T.Meeting[],
    approvals: approvals.data as T.Approval[],
    focus: focus.data as T.Focus[],
    notifications: notifications.data as T.Notification[],
    announcements: announcements.data as T.Announcement[],
    recognition: recognition.data as T.Recognition[],
    files: files.data as T.FileRecord[],
    periods: periods.data as T.Period[],
    activity: activity.data as {
      id: string;
      event: string;
      created_at: string;
    }[],
    reminders: reminders.data as {
      id: string;
      state: string;
      run_at: string;
      attempts: number;
    }[],
    unread: unread.data as { id: string; unread_count: number }[],
    progress: progress.data as {
      project_id: string;
      total: number;
      completed: number;
      progress: number;
    }[],
    counts: parsed.data,
  };
});
export type WorkspaceData = Awaited<ReturnType<typeof loadWorkspace>>;
export async function loadMessages(
  conversationId: string,
): Promise<T.Message[]> {
  const session = await requireWorkspaceSession();
  if (session.preview || !z.uuid().safeParse(conversationId).success) return [];
  const db = await createClient();
  const { data, error } = await db
    .from("messages")
    .select("id,conversation_id,sender_id,body,created_at,kind,attachment_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Messages could not be loaded.");
  return (data as T.Message[]).reverse();
}
