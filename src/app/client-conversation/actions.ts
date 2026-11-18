"use server";

import { revalidatePath } from "next/cache";
import { requirePortalAccess } from "../client/access";
import { requireDashboardAccess } from "../dashboard/access";
import { clientDirectoryPath, isClientId } from "../dashboard/clients/directory";

export type SendState = { error?: string; sent?: boolean };

export async function sendClientMessage(side: "staff" | "client", id: string | null, _state: SendState, form: FormData): Promise<SendState> {
  const value = form.get("message");
  const body = typeof value === "string" ? value.trim() : "";
  if (!body || body.length > 2000) return { error: "Enter a message up to 2,000 characters." };

  const access = side === "staff" ? await requireDashboardAccess() : await requirePortalAccess();
  if ("role" in access && access.role !== "Admin") return { error: "Only an Admin can send messages to clients." };
  const clientId = "clientId" in access ? access.clientId : id;
  if (!clientId || !isClientId(clientId)) return { error: "This conversation is unavailable." };
  const requestId = form.get("requestId");
  if (typeof requestId !== "string" || !isClientId(requestId)) return { error: "Message could not be sent. Try again." };
  const { error } = await access.client.from("client_conversation_messages").upsert({
    client_id: clientId, sender_side: "clientId" in access ? "client" : "staff", body, request_id: requestId,
  }, { onConflict: "client_id,sender_side,request_id", ignoreDuplicates: true });
  if (error) return { error: "Message could not be sent. Try again." };
  revalidatePath("clientId" in access ? "/client/portal/messages" : clientDirectoryPath + "/" + clientId);
  return { sent: true };
}

export async function markClientMessagesRead(side: "staff" | "client", id: string, messages: number[]) {
  if (!isClientId(id) || !Array.isArray(messages) || !messages.length || messages.length > 50 ||
    messages.some((message) => !Number.isSafeInteger(message) || message <= 0)) return;
  const access = side === "staff" ? await requireDashboardAccess() : await requirePortalAccess();
  if ("clientId" in access && access.clientId !== id) return;
  await access.client.rpc("mark_client_messages_read", { p_client: id, p_messages: messages });
}
