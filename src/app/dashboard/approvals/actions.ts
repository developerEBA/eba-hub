"use server";

import { revalidatePath } from "next/cache";
import { isRequestId, requireApprovalsAccess } from "./review";

export async function decideRequest(_previous: string | null, form: FormData) {
  const { client } = await requireApprovalsAccess();
  const id = form.get("id");
  const decision = form.get("decision");
  const rawNote = form.get("note");
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (typeof id !== "string" || !isRequestId(id) ||
      (decision !== "approved" && decision !== "changes_requested" && decision !== "rejected") ||
      note.length > 2000) return "Check the decision and try again.";
  if (decision === "changes_requested" && !note) return "Enter a note explaining what should change.";

  const { data, error } = await client.rpc("decide_approval", {
    request_id: id,
    decision,
    note: decision === "approved" ? null : note || null,
  });
  if (error) return "The decision could not be saved.";
  revalidatePath("/dashboard/approvals");
  if (data === "saved") return null;
  if (data === "decided") return "Another reviewer has already decided this request.";
  return "The request is unavailable or its required supporting document is missing.";
}
