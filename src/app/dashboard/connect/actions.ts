"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHodDashboardAccess } from "../access";
import { isConversationId } from "./model";
import { audioTypes, isSticker, maxAudioBytes } from "./media";

export async function openDirectMessage(_previous: string | null, form: FormData) {
  const { client } = await requireHodDashboardAccess();
  const recipient = form.get("recipient");
  if (!isConversationId(recipient)) return "Conversation unavailable.";

  const { data, error } = await client.rpc("connect_open_dm", { recipient });
  if (error || !isConversationId(data)) return "Conversation unavailable.";
  redirect("/dashboard/connect?chat=" + data);
}

export async function sendConnectMessage(_previous: string | null, form: FormData) {
  const { client, user } = await requireHodDashboardAccess();
  const conversation = form.get("conversation");
  const clientId = form.get("clientId");
  const kind = form.get("kind") ?? "text";
  const value = form.get("body");
  const body = typeof value === "string" ? value.trim() : "";
  if (!isConversationId(conversation) || !isConversationId(clientId)) return "Conversation unavailable.";
  if (kind !== "text" && kind !== "sticker" && kind !== "voice") return "Unsupported message.";
  if (kind === "text" && (!body || body.length > 4000)) return "Enter a message between 1 and 4,000 characters.";
  if (kind === "sticker" && !isSticker(body)) return "Choose a sticker.";

  const files = client.storage.from("connect-voice");
  let audioPath: string | null = null;
  if (kind === "voice") {
    const audio = form.get("audio");
    const mime = audio instanceof File ? audio.type.split(";")[0] : "";
    if (!(audio instanceof File) || !audioTypes.includes(mime) || !audio.size || audio.size > maxAudioBytes) {
      return "This recording is unsupported or too large. Try a shorter voice note.";
    }
    audioPath = conversation.toLowerCase() + "/" + user.id + "/" + crypto.randomUUID();
    const { error } = await files.upload(audioPath, audio, { contentType: mime, upsert: false });
    if (error) return "Voice note upload failed. Try again.";
  }

  const { error } = await client.from("connect_messages").insert({
    conversation_id: conversation, body: kind === "voice" ? "Voice note" : body,
    kind, audio_path: audioPath, client_id: clientId,
  });
  if (error && audioPath) await files.remove([audioPath]);
  if (error && error.code !== "23505") return "Message could not be sent. Try again.";
  revalidatePath("/dashboard/connect");
  return null;
}

export async function readConnectChat(room: string, throughId: number) {
  const { client } = await requireHodDashboardAccess();
  if (!isConversationId(room) || !Number.isSafeInteger(throughId) || throughId < 1) return false;
  const { error } = await client.rpc("connect_read_chat", { room, through_id: throughId });
  return !error;
}

export async function changeConnectMessage(id: number, operation: "edit" | "delete", replacement: string) {
  const { client } = await requireHodDashboardAccess();
  if (!Number.isSafeInteger(id) || id < 1 || !["edit", "delete"].includes(operation)) {
    return "Message unavailable.";
  }
  const body = typeof replacement === "string" ? replacement.trim() : "";
  if (operation === "edit" && (!body || body.length > 4000)) return "Enter a message between 1 and 4,000 characters.";

  const { error, data } = await client.rpc("connect_change_message", {
    message: id, operation, replacement: operation === "edit" ? body : null,
  });
  if (error || data !== true) return "Could not update this message.";
  revalidatePath("/dashboard/connect");
  return null;
}
