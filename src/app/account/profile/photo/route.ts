import { accountActor, accountHeaders, profileAdmin, profilePhotoPath, validDisplayName } from "../../../../lib/account-profile/server";
import { trustedOrigin } from "../../../../lib/staff-access/server";

const maxPhotoBytes = 2 * 1024 * 1024;

function matchesImageSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === "image/webp") return String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
  return false;
}

export async function POST(request: Request) {
  if (!trustedOrigin(request)) return Response.json({ error: "Request origin denied." }, { status: 403, headers: accountHeaders });
  const actor = await accountActor();
  if (!actor) return Response.json({ error: "An active company account is required." }, { status: 403, headers: accountHeaders });
  if (Number(request.headers.get("content-length")) > maxPhotoBytes + 16000) return Response.json({ error: "Photo must be 2 MB or smaller." }, { status: 413, headers: accountHeaders });
  try {
    const form = await request.formData(), file = form.get("photo");
    if (!(file instanceof File) || !file.size || file.size > maxPhotoBytes) throw new Error("Choose an image up to 2 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesImageSignature(bytes, file.type)) throw new Error("Use a valid JPG, PNG, or WebP image.");
    const admin = profileAdmin();
    if (!admin) throw new Error("Photo storage is unavailable.");
    const path = `${actor.user.id}/avatar`;
    const uploaded = await admin.storage.from("hub-profile-photos").upload(path, bytes, { contentType: file.type, cacheControl: "0", upsert: true });
    if (uploaded.error) throw new Error("Photo could not be saved. Retry with a smaller image.");
    const [{ data: prior }, { data: accessProfile }] = await Promise.all([
      admin.from("connect_profiles").select("display_name").eq("user_id", actor.user.id).maybeSingle(),
      admin.from("staff_access_profiles").select("name").eq("user_id", actor.user.id).maybeSingle(),
    ]);
    const name = prior?.display_name ?? accessProfile?.name ?? actor.user.user_metadata?.full_name ?? actor.user.user_metadata?.name ?? "Team member";
    const profile = await admin.from("connect_profiles").upsert({ user_id: actor.user.id, display_name: validDisplayName(name) ? name : "Team member", avatar_url: profilePhotoPath(actor.user.id) }, { onConflict: "user_id" });
    if (profile.error) throw new Error("Photo was uploaded but profile details could not be refreshed. Retry.");
    return Response.json({ ok: true, avatar: `${profilePhotoPath(actor.user.id)}?v=${Date.now()}`, message: "Profile photo saved." }, { headers: accountHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Photo could not be saved. Retry." }, { status: 400, headers: accountHeaders });
  }
}
