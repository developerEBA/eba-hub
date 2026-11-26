import { accountActor, accountHeaders } from "../../../../lib/account-profile/server";
import { trustedOrigin } from "../../../../lib/staff-access/server";

const passwordLimits = { min: 12, max: 128 };

export async function POST(request: Request) {
  if (!trustedOrigin(request)) return Response.json({ error: "Request origin denied." }, { status: 403, headers: accountHeaders });
  const actor = await accountActor();
  if (!actor || !actor.user.email) return Response.json({ error: "An active company account is required." }, { status: 403, headers: accountHeaders });

  try {
    const raw = await request.text();
    if (raw.length > 6000) return Response.json({ error: "Password request is too large." }, { status: 413, headers: accountHeaders });
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Enter your current password and a matching new password.");
    const input = body as Record<string, unknown>;
    const currentPassword = input.currentPassword;
    const newPassword = input.newPassword;
    const confirmPassword = input.confirmPassword;
    if (typeof currentPassword !== "string" || currentPassword.length < 1
      || typeof newPassword !== "string" || newPassword.length < passwordLimits.min || newPassword.length > passwordLimits.max
      || confirmPassword !== newPassword) {
      throw new Error(`Enter your current password and a matching new password (${passwordLimits.min}–${passwordLimits.max} characters).`);
    }

    const verified = await actor.client.auth.signInWithPassword({ email: actor.user.email, password: currentPassword });
    if (verified.error || verified.data.user?.id !== actor.user.id) {
      return Response.json({ error: "Current password could not be verified." }, { status: 400, headers: accountHeaders });
    }

    const updated = await actor.client.auth.updateUser({ current_password: currentPassword, password: newPassword });
    if (updated.error) return Response.json({ error: "Password could not be changed. Check the new password requirements and retry." }, { status: 400, headers: accountHeaders });
    return Response.json({ ok: true, message: "Password updated." }, { headers: accountHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Password could not be changed. Retry." }, { status: 400, headers: accountHeaders });
  }
}
