import { accountActor, accountHeaders, profileAdmin, profilePhotoPath } from "../../../../../lib/account-profile/server";

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const actor = await accountActor();
  if (!actor) return new Response(null, { status: 403, headers: accountHeaders });
  const { userId } = await params;
  if (!uuid.test(userId)) return new Response(null, { status: 404, headers: accountHeaders });
  const admin = profileAdmin();
  if (!admin) return new Response(null, { status: 503, headers: accountHeaders });
  const [{ data: membership }, { data: profile }, identity] = await Promise.all([
    admin.from("staff_memberships").select("status").eq("user_id", userId).maybeSingle(),
    admin.from("connect_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  if (membership?.status !== "active" || !identity.data.user?.email || !/^[^@]+@enibrand\.com$/i.test(identity.data.user.email)
    || profile?.avatar_url !== profilePhotoPath(userId)) return new Response(null, { status: 404, headers: accountHeaders });
  const { data: file, error } = await admin.storage.from("hub-profile-photos").download(`${userId}/avatar`);
  if (error || !file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return new Response(null, { status: 404, headers: accountHeaders });
  return new Response(file, { headers: { ...accountHeaders, "Content-Type": file.type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
