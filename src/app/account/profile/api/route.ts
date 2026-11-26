import { accountActor, accountHeaders, profileAdmin, profilePhotoPath, validCompanyEmail, validDisplayName } from "../../../../lib/account-profile/server";
import { trustedOrigin } from "../../../../lib/staff-access/server";

export async function GET() {
  const actor = await accountActor();
  if (!actor) return Response.json({ error: "An active company account is required." }, { status: 403, headers: accountHeaders });
  const admin = profileAdmin();
  if (!admin) return Response.json({ error: "Profile service is unavailable." }, { status: 503, headers: accountHeaders });
  const [profileResult, accessResult] = await Promise.all([
    admin.from("connect_profiles").select("display_name,avatar_url").eq("user_id", actor.user.id).maybeSingle(),
    admin.from("staff_access_profiles").select("name").eq("user_id", actor.user.id).maybeSingle(),
  ]);
  if (profileResult.error || accessResult.error) return Response.json({ error: "Profile details could not be loaded. Please retry." }, { status: 503, headers: accountHeaders });
  const profile = profileResult.data, accessProfile = accessResult.data;
  const name = profile?.display_name ?? accessProfile?.name ?? actor.user.user_metadata?.full_name ?? actor.user.user_metadata?.name ?? "";
  const avatar = profile?.avatar_url?.startsWith("/account/profile/photo/") ? profilePhotoPath(actor.user.id) : profile?.avatar_url ?? null;
  return Response.json({ name, email: actor.user.email ?? "", avatar, role: actor.role }, { headers: accountHeaders });
}

export async function POST(request: Request) {
  if (!trustedOrigin(request)) return Response.json({ error: "Request origin denied." }, { status: 403, headers: accountHeaders });
  const actor = await accountActor();
  if (!actor) return Response.json({ error: "An active company account is required." }, { status: 403, headers: accountHeaders });
  try {
    const raw = await request.text();
    if (raw.length > 4000) return Response.json({ error: "Profile update is too large." }, { status: 413, headers: accountHeaders });
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Enter a name and company email.");
    const input = body as Record<string, unknown>;
    if (!validDisplayName(input.name) || !validCompanyEmail(input.email)) throw new Error("Use a name up to 120 characters and a valid @enibrand.com email.");
    const name = input.name.trim(), email = input.email.trim().toLowerCase();
    const emailChanged = email !== actor.user.email?.toLowerCase();
    const admin = profileAdmin();
    if (!admin) return Response.json({ error: "Profile service is unavailable." }, { status: 503, headers: accountHeaders });
    const update = await actor.client.auth.updateUser({
      ...(emailChanged ? { email } : {}),
      data: { ...actor.user.user_metadata, full_name: name, name },
    });
    if (update.error) throw new Error(emailChanged ? "Email update could not be started. Verify the address and try again." : "Profile name could not be updated. Try again.");

    const prior = await admin.from("connect_profiles").select("avatar_url").eq("user_id", actor.user.id).maybeSingle();
    const avatar = prior.data?.avatar_url ?? (typeof actor.user.user_metadata?.avatar_url === "string" && /^https:\/\//.test(actor.user.user_metadata.avatar_url) ? actor.user.user_metadata.avatar_url : null);
    const [connectResult, accessResult] = await Promise.all([
      admin.from("connect_profiles").upsert({ user_id: actor.user.id, display_name: name, avatar_url: avatar }, { onConflict: "user_id" }),
      admin.from("staff_access_profiles").upsert({ user_id: actor.user.id, name }, { onConflict: "user_id" }),
    ]);
    if (connectResult.error || accessResult.error) throw new Error("Profile details could not be fully saved. Refresh and retry.");
    return Response.json({ ok: true, name, email: actor.user.email ?? email, emailPending: emailChanged,
      message: emailChanged ? "Name saved. Check the new address to confirm the email change; your current sign-in email stays active until confirmation." : "Profile saved." }, { headers: accountHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Profile could not be saved. Try again." }, { status: 400, headers: accountHeaders });
  }
}
