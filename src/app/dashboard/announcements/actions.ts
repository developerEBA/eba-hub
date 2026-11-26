"use server";

import { revalidatePath } from "next/cache";
import { requireDashboardAccess } from "../access";

const departments = ["graphics", "development", "communications", "events", "marketing"] as const;
export type AnnouncementPayload = {
  title: string; body: string; audience_type: "company" | "departments";
  departments: string[]; expires_at: string | null;
};

function safePayload(value: AnnouncementPayload): AnnouncementPayload | null {
  if (!value || typeof value.title !== "string" || typeof value.body !== "string"
    || (value.expires_at !== null && typeof value.expires_at !== "string")
    || !["company", "departments"].includes(value.audience_type)
    || !Array.isArray(value.departments) || value.departments.some((d) => !departments.includes(d as typeof departments[number]))) return null;
  const title = value.title.trim(); const body = value.body.trim();
  const selected = [...new Set(value.departments)];
  if (!title || title.length > 160 || !body || body.length > 12000
    || (value.audience_type === "company" && selected.length)
    || (value.audience_type === "departments" && !selected.length)) return null;
  const expires = value.expires_at ? new Date(value.expires_at) : null;
  if (expires && Number.isNaN(expires.getTime())) return null;
  return { title, body, audience_type: value.audience_type, departments: selected, expires_at: expires?.toISOString() ?? null };
}

export async function manageAnnouncement(action: "create" | "create_publish" | "edit" | "publish" | "archive", id: string | null,
  revision: number | null, payload?: AnnouncementPayload, requestId?: string) {
  const { client } = await requireDashboardAccess();
  if (!(["create", "create_publish", "edit", "publish", "archive"] as const).includes(action)) return { error: "Invalid action." };
  if (id !== null && !/^[\da-f-]{36}$/i.test(id)) return { error: "Announcement unavailable." };
  if (revision !== null && (!Number.isInteger(revision) || revision < 1)) return { error: "Reload this announcement." };
  if ((action === "create" || action === "create_publish") && (!requestId || !/^[\da-f-]{36}$/i.test(requestId))) return { error: "Refresh the form and try again." };
  const data = action === "create" || action === "create_publish" || action === "edit" ? safePayload(payload!) : {};
  if ((action === "create" || action === "create_publish" || action === "edit") && !data) return { error: "Check the title, message, expiry and audience." };
  const { data: result, error } = await client.rpc("announcement_manage", {
    p_action: action, p_id: id, p_expected_revision: revision, p_payload: data ?? {}, p_request: requestId ?? null,
  });
  if (error || !result) return { error: error?.message?.includes("changed") ? "This announcement changed. Reload and try again." : "Announcement could not be saved. Check access and try again." };
  revalidatePath("/dashboard/announcements");
  revalidatePath("/dashboard/announcements/history");
  return { result };
}
