"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceRole } from "@/modules/auth/server";
import { roles } from "@/modules/auth/permissions";
export async function registerUploadedFile(input: {
  path: string;
  name: string;
  conversationId?: string;
}) {
  const parsed = z
    .object({
      path: z.string().max(300),
      name: z.string().trim().min(1).max(180),
      conversationId: z.uuid().optional(),
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, message: "Invalid file details." };
  const session = await requireWorkspaceRole(roles);
  const db = await createClient();
  if (!new RegExp(`^${session.userId}/[0-9a-f-]{36}$`).test(parsed.data.path))
    return { ok: false as const, message: "Invalid upload location." };
  const { data: info, error } = await db.storage
    .from("workspace-files")
    .info(parsed.data.path);
  const allowed = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
    "text/plain",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
  ];
  if (
    error ||
    !info?.size ||
    info.size > 4194304 ||
    !allowed.includes(info.contentType ?? "")
  )
    return {
      ok: false as const,
      message:
        "Upload could not be verified. Limit: 4 MB; approved image, PDF, text or audio formats.",
    };
  const { data, error: saveError } = await db
    .from("workspace_files")
    .insert({
      owner_id: session.userId,
      path: parsed.data.path,
      name: parsed.data.name,
      conversation_id: parsed.data.conversationId ?? null,
      size_bytes: info.size,
      mime_type: info.contentType,
    })
    .select("id")
    .single();
  if (saveError || !data)
    return {
      ok: false as const,
      message:
        "File metadata could not be saved. Check conversation membership.",
    };
  revalidatePath("/dashboard", "layout");
  return {
    ok: true as const,
    id: String(data.id),
    message: "File uploaded and recorded.",
  };
}
export async function getFileLink(id: string, audio = false) {
  if (!z.uuid().safeParse(id).success)
    return { ok: false as const, message: "Invalid file." };
  await requireWorkspaceRole(roles);
  const db = await createClient();
  const { data: file, error } = await db
    .from("workspace_files")
    .select("path,name,mime_type")
    .eq("id", id)
    .single();
  if (error || !file)
    return {
      ok: false as const,
      message: "File unavailable or permission denied.",
    };
  if (audio && !String(file.mime_type).startsWith("audio/"))
    return { ok: false as const, message: "This is not an audio file." };
  const { data, error: linkError } = await db.storage
    .from("workspace-files")
    .createSignedUrl(
      file.path,
      60,
      audio ? undefined : { download: file.name },
    );
  if (linkError || !data)
    return { ok: false as const, message: "File link could not be created." };
  return { ok: true as const, url: data.signedUrl };
}
