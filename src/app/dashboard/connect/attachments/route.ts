import { createClient } from "@supabase/supabase-js";
import { requireHodDashboardAccess } from "../../access";
import { isConversationId } from "../model";
import { attachmentLimit, captionLimit, documentType, photoTypes } from "./config";

function errorResponse(message: string, status: number) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function signatureMatches(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  switch (file.type) {
    case "image/jpeg": return starts(255, 216, 255);
    case "image/png": return starts(137, 80, 78, 71, 13, 10, 26, 10);
    case "image/webp": return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case documentType: return ascii(0, 5) === "%PDF-";
    default: return false;
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return errorResponse("Request unavailable.", 403);
  const { client, user } = await requireHodDashboardAccess();
  const bodyLimit = attachmentLimit + 16000;
  const length = Number(request.headers.get("content-length"));
  if (length > bodyLimit) {
    return errorResponse("Choose a file under 4 MB.", 413);
  }

  let form: FormData;
  try {
    const reader = request.body?.getReader();
    if (!reader) return errorResponse("Choose a valid file.", 400);
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > bodyLimit) {
        await reader.cancel();
        return errorResponse("Choose a file under 4 MB.", 413);
      }
      chunks.push(value);
    }
    form = await new Response(new Uint8Array(Buffer.concat(chunks)), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return errorResponse("Choose a valid file.", 400);
  }

  const conversation = form.get("conversation");
  const retryId = form.get("clientId");
  const file = form.get("file");
  const rawCaption = form.get("caption");
  const caption = typeof rawCaption === "string" ? rawCaption.trim() : "";
  if (!isConversationId(conversation) || !isConversationId(retryId)) {
    return errorResponse("Conversation unavailable.", 404);
  }

  const { data: room } = await client.from("connect_conversations")
    .select("id").eq("id", conversation).maybeSingle();
  if (!room) return errorResponse("Conversation unavailable.", 404);

  if (!(file instanceof File) || file.size === 0 || file.size > attachmentLimit || caption.length > captionLimit) {
    return errorResponse("Choose a nonempty file up to 4 MB and a caption up to 1,000 characters.", 400);
  }
  if (!(await signatureMatches(file))) return errorResponse("Choose a valid JPEG, PNG, WebP, or PDF.", 415);

  const kind = photoTypes.includes(file.type) ? "photo" : "document";
  const filename = Array.from(file.name.replace(/[\/\\\u0000-\u001f\u007f]/g, "_").trim()).slice(0, 180).join("");
  if (!filename) return errorResponse("Choose a file with a valid name.", 400);

  const success = () => new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  const findRetry = () => client.from("connect_messages").select("id,conversation_id,kind")
    .eq("sender_id", user.id).eq("client_id", retryId).maybeSingle();
  const existing = await findRetry();
  if (existing.error) return errorResponse("Could not check this attachment. Try again.", 503);
  if (existing.data) {
    return existing.data.conversation_id === room.id && existing.data.kind === kind
      ? success() : errorResponse("This upload was already used.", 409);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return errorResponse("Attachment storage is unavailable.", 503);

  // Only the server can stage validated objects. The message is still written under user RLS.
  const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    .storage.from("connect-attachments");
  const path = room.id + "/" + user.id + "/" + crypto.randomUUID();
  const upload = await storage.upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) return errorResponse("Upload failed. Try again.", 503);

  const { error } = await client.from("connect_messages").insert({
    conversation_id: room.id, client_id: retryId, body: kind === "photo" ? "Photo" : "Document", kind,
    attachment_path: path, attachment_name: filename, attachment_size: file.size,
    attachment_mime: file.type, attachment_caption: caption || null,
  });
  if (!error) return success();

  // A failed response can follow a successful commit. Check before deleting a staged file.
  const retry = await client.from("connect_messages").select("id,conversation_id,kind,attachment_path")
    .eq("sender_id", user.id).eq("client_id", retryId).maybeSingle();
  if (!retry.error && retry.data?.attachment_path !== path) await storage.remove([path]);
  if (retry.data && retry.data.conversation_id === room.id && retry.data.kind === kind) return success();
  return errorResponse("Attachment could not be sent. Try again.", 409);
}
