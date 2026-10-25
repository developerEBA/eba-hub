"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceRole } from "@/modules/auth/server";
import { roles } from "@/modules/auth/permissions";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { operationSchema, toInstant } from "./schemas";
export type ActionResult = { ok: boolean; message: string };
export async function mutateWorkspace(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  if (!getSupabaseConfig())
    return {
      ok: false,
      message: "Setup required: configure Supabase before saving records.",
    };
  const parsed = operationSchema.safeParse({
    ...Object.fromEntries(form),
    members: form.getAll("members"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  const session = await requireWorkspaceRole(roles);
  const db = await createClient();
  const input = parsed.data;
  let error: { code?: string; message: string } | null = null;
  const updated = async (
    query: PromiseLike<{
      error: { code?: string; message: string } | null;
      data: unknown;
    }>,
  ) => {
    const result = await query;
    error = result.error;
    if (
      !error &&
      (!result.data || (Array.isArray(result.data) && !result.data.length))
    )
      error = { message: "Record not found or permission denied." };
  };
  try {
    switch (input.operation) {
      case "task.save": {
        const { id, operation: _, ...task } = input;
        void _;
        const values = {
          ...task,
          due_at: toInstant(task.due_at),
          updated_at: new Date().toISOString(),
        };
        if (id) {
          const { project_id: unchangedProject, ...changes } = values;
          void unchangedProject;
          await updated(
            db.from("tasks").update(changes).eq("id", id).select("id").single(),
          );
        } else
          await updated(
            db
              .from("tasks")
              .insert({ ...values, created_by: session.userId })
              .select("id")
              .single(),
          );
        break;
      }
      case "task.toggle":
        await updated(
          db
            .from("tasks")
            .update({
              status: input.complete === "true" ? "complete" : "todo",
              updated_at: new Date().toISOString(),
            })
            .eq("id", input.id)
            .select("id")
            .single(),
        );
        break;
      case "task.delete":
        await updated(
          db.from("tasks").delete().eq("id", input.id).select("id").single(),
        );
        break;
      case "project.save":
        if (input.id)
          await updated(
            db
              .from("projects")
              .update({
                name: input.name,
                status: input.status,
                deadline: toInstant(input.deadline),
              })
              .eq("id", input.id)
              .select("id")
              .single(),
          );
        else {
          if (input.status !== "planning")
            return {
              ok: false,
              message:
                "New projects start in planning; change status after creation.",
            };
          ({ error } = await db.rpc("create_workspace_project", {
            project_name: input.name,
            department: input.department_id,
            due: toInstant(input.deadline),
            members: input.members,
          }));
        }
        break;
      case "project.members":
        ({ error } = await db.rpc("set_project_members", {
          project: input.id,
          members: input.members,
        }));
        break;
      case "conversation.create":
        ({ error } = await db.rpc("create_workspace_conversation", {
          conversation_title: input.title,
          conversation_kind: input.kind,
          members: input.members,
        }));
        break;
      case "message.send":
        await updated(
          db
            .from("messages")
            .insert({
              conversation_id: input.conversation_id,
              sender_id: session.userId,
              body: input.body,
              kind: input.kind,
              attachment_id: input.attachment_id ?? null,
            })
            .select("id")
            .single(),
        );
        break;
      case "conversation.read":
        await updated(
          db
            .from("conversation_memberships")
            .update({ last_read_at: new Date().toISOString() })
            .eq("conversation_id", input.id)
            .eq("employee_id", session.userId)
            .select("conversation_id")
            .single(),
        );
        break;
      case "meeting.save": {
        const start = toInstant(input.starts_at),
          end = toInstant(input.ends_at);
        if (!start || !end || end <= start)
          return { ok: false, message: "Meeting end must be after its start." };
        if (input.id)
          await updated(
            db
              .from("meetings")
              .update({ title: input.title, starts_at: start, ends_at: end })
              .eq("id", input.id)
              .select("id")
              .single(),
          );
        else
          ({ error } = await db.rpc("schedule_workspace_meeting", {
            meeting_title: input.title,
            start_time: start,
            end_time: end,
            attendees: input.members,
          }));
        break;
      }
      case "meeting.members":
        ({ error } = await db.rpc("update_meeting_attendees", {
          meeting: input.id,
          attendees: input.members,
        }));
        break;
      case "approval.create":
        await updated(
          db
            .from("approvals")
            .insert({
              title: input.title,
              body: input.body,
              requester_id: session.userId,
            })
            .select("id")
            .single(),
        );
        break;
      case "approval.review":
        ({ error } = await db.rpc("review_approval", {
          target: input.id,
          decision: input.decision,
        }));
        break;
      case "leave.submit":
        if (input.ends_on < input.starts_on)
          return {
            ok: false,
            message: "Leave end must be on or after the start date.",
          };
        ({ error } = await db.rpc("submit_leave", {
          start_date: input.starts_on,
          end_date: input.ends_on,
          reason: input.reason,
        }));
        break;
      case "focus.create":
        await updated(
          db
            .from("focus_items")
            .insert({ employee_id: session.userId, title: input.title })
            .select("id")
            .single(),
        );
        break;
      case "focus.toggle":
        await updated(
          db
            .from("focus_items")
            .update({ complete: input.complete === "true" })
            .eq("id", input.id)
            .select("id")
            .single(),
        );
        break;
      case "focus.delete":
        await updated(
          db
            .from("focus_items")
            .delete()
            .eq("id", input.id)
            .select("id")
            .single(),
        );
        break;
      case "profile.save":
        await updated(
          db
            .from("employee_profiles")
            .update({ display_name: input.display_name })
            .eq("id", session.userId)
            .select("id")
            .single(),
        );
        break;
      case "notification.read":
        await updated(
          db
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("id", input.id)
            .select("id")
            .single(),
        );
        break;
      case "announcement.create":
        await updated(
          db
            .from("announcements")
            .insert({
              author_id: session.userId,
              title: input.title,
              body: input.body,
            })
            .select("id")
            .single(),
        );
        break;
      case "period.create":
        if (input.ends_on < input.starts_on)
          return { ok: false, message: "Invalid award period dates." };
        await updated(
          db
            .from("award_periods")
            .insert({
              title: input.title,
              starts_on: input.starts_on,
              ends_on: input.ends_on,
            })
            .select("id")
            .single(),
        );
        break;
      case "nomination.create":
        ({ error } = await db.rpc("submit_nomination", {
          period: input.period_id,
          nominee: input.nominee_id,
          reason: input.reason,
        }));
        break;
    }
  } catch {
    return {
      ok: false,
      message:
        "The operation could not be saved. Check connectivity and try again.",
    };
  }
  if (error) {
    const failure = error as { code?: string; message: string };
    return {
      ok: false,
      message:
        failure.code === "42501"
          ? "Permission denied. Your stored role or membership does not allow this change."
          : failure.code === "23505"
            ? "This record already exists."
            : "The database rejected this change. Check permissions, related records and migrations.",
    };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Saved to the database." };
}
