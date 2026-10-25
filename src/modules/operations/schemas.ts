import { z } from "zod";
const optionalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.uuid().optional(),
);
const nullableId = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid().nullable(),
);
const title = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(3000);
const datetime = z
  .string()
  .refine(
    (value) => !value || Number.isFinite(Date.parse(value)),
    "Use a valid date and time.",
  );
export const operationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("task.save"),
    id: optionalId,
    title,
    project_id: z.uuid(),
    assignee_id: nullableId,
    status: z.enum(["todo", "in_progress", "complete"]),
    priority: z.enum(["low", "medium", "high"]),
    due_at: datetime,
  }),
  z.object({
    operation: z.literal("task.toggle"),
    id: z.uuid(),
    complete: z.enum(["true", "false"]),
  }),
  z.object({ operation: z.literal("task.delete"), id: z.uuid() }),
  z.object({
    operation: z.literal("project.save"),
    id: optionalId,
    name: title,
    department_id: z.uuid(),
    deadline: datetime,
    status: z.enum(["planning", "active", "complete", "archived"]),
    members: z.array(z.uuid()).max(100).default([]),
  }),
  z.object({
    operation: z.literal("project.members"),
    id: z.uuid(),
    members: z.array(z.uuid()).max(100),
  }),
  z.object({
    operation: z.literal("conversation.create"),
    title,
    kind: z.enum(["private", "channel"]),
    members: z.array(z.uuid()).min(1).max(100),
  }),
  z.object({
    operation: z.literal("message.send"),
    conversation_id: z.uuid(),
    body: z.string().trim().min(1).max(10000),
    kind: z.enum(["text", "file", "voice", "sticker"]).default("text"),
    attachment_id: optionalId,
  }),
  z.object({ operation: z.literal("conversation.read"), id: z.uuid() }),
  z.object({
    operation: z.literal("meeting.save"),
    id: optionalId,
    title,
    starts_at: datetime.refine(Boolean, "Start time is required."),
    ends_at: datetime.refine(Boolean, "End time is required."),
    members: z.array(z.uuid()).max(100).default([]),
  }),
  z.object({
    operation: z.literal("meeting.members"),
    id: z.uuid(),
    members: z.array(z.uuid()).max(100),
  }),
  z.object({ operation: z.literal("approval.create"), title, body: text }),
  z.object({
    operation: z.literal("approval.review"),
    id: z.uuid(),
    decision: z.enum(["approved", "rejected"]),
  }),
  z.object({
    operation: z.literal("leave.submit"),
    starts_on: z.iso.date(),
    ends_on: z.iso.date(),
    reason: text,
  }),
  z.object({ operation: z.literal("focus.create"), title }),
  z.object({
    operation: z.literal("focus.toggle"),
    id: z.uuid(),
    complete: z.enum(["true", "false"]),
  }),
  z.object({ operation: z.literal("focus.delete"), id: z.uuid() }),
  z.object({
    operation: z.literal("profile.save"),
    display_name: z.string().trim().min(2).max(120),
  }),
  z.object({ operation: z.literal("notification.read"), id: z.uuid() }),
  z.object({
    operation: z.literal("announcement.create"),
    title,
    body: z.string().trim().min(1).max(5000),
  }),
  z.object({
    operation: z.literal("period.create"),
    title,
    starts_on: z.iso.date(),
    ends_on: z.iso.date(),
  }),
  z.object({
    operation: z.literal("nomination.create"),
    period_id: z.uuid(),
    nominee_id: z.uuid(),
    reason: z.string().trim().min(1).max(2000),
  }),
]);
export type Operation = z.infer<typeof operationSchema>;
export function toInstant(value: string): string | null {
  if (!value) return null;
  return new Date(
    /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}+01:00`,
  ).toISOString();
}
export function validMeetUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "meet.google.com" &&
      /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function projectProgress(tasks: readonly { status: string }[]): number {
  return tasks.length
    ? Math.round(
        (100 * tasks.filter((task) => task.status === "complete").length) /
          tasks.length,
      )
    : 0;
}

export function matchesDue(
  value: string | null,
  filter?: string,
  now: Date = new Date(),
): boolean {
  if (!filter) return true;
  if (!value) return false;
  const due = Date.parse(value);
  const lagosDate = new Date(now.getTime() + 3600000)
    .toISOString()
    .slice(0, 10);
  const start = Date.parse(`${lagosDate}T00:00:00+01:00`);
  if (filter === "today") return due >= start && due < start + 86400000;
  if (filter === "overdue") return due < now.getTime();
  if (filter === "week") {
    const day = new Date(start + 3600000).getUTCDay();
    const weekStart = start - ((day + 6) % 7) * 86400000;
    return due >= weekStart && due < weekStart + 7 * 86400000;
  }
  return true;
}
