"use server";

import { revalidatePath } from "next/cache";
import { requireDashboardAccess } from "../access";

export async function markNotification(_previous: string | null, form: FormData) {
  const { client, user } = await requireDashboardAccess();
  const id = form.get("id");
  let query = client.from("hub_notifications").update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id).is("read_at", null);
  if (typeof id === "string" && /^[1-9]\d{0,14}$/.test(id)) query = query.eq("id", id);
  else if (id !== "all") return "Notification unavailable.";

  const { error } = await query;
  if (error) return "Could not mark notifications as read.";
  revalidatePath("/dashboard", "layout");
  return null;
}
