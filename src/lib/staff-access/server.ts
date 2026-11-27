import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createStaffClient, getStaffRole } from "../staff-auth";
import { assignment, companyEmail, idPattern } from "./model";
import { directoryResponse, staffFailure, staffFailureMessage } from "./diagnostics";
export const staffHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
export function staffAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
}
export async function staffActor() {
  const client = await createStaffClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || !data.user.email_confirmed_at) return null;
  const role = await getStaffRole(client, data.user);
  return role ? { id: data.user.id, role } : null;
}
export function appOrigin() {
  const raw = process.env.EBA_APP_URL;
  if (!raw) throw Error("Configure EBA_APP_URL before generating invitations.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Error("Check the configured application origin.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        url.hostname === "localhost" &&
        url.protocol === "http:"
      ))
  )
    throw Error("Check the configured application origin.");
  return url.origin;
}
export function trustedOrigin(request: Request) {
  try {
    return request.headers.get("origin") === appOrigin();
  } catch {
    return false;
  }
}
export function hashInvite(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function staffRPC(
  action: string,
  actor: string | null,
  data: Record<string, unknown> = {},
) {
  const db = staffAdmin();
  if (!db) {
    console.warn({
      event: "staff_access_rpc",
      action: "configuration",
      category: "server_client_unavailable",
    });
    throw Error("Staff access unavailable.");
  }
  try {
    const result =
      action === "update_assignments"
        ? await db
            .rpc("staff_access_update_assignments", { p_actor: actor, p_data: data })
            .abortSignal(AbortSignal.timeout(8000))
        : action === "delete_member"
          ? await db
              .rpc("staff_access_delete_member", { p_actor: actor, p_data: data })
              .abortSignal(AbortSignal.timeout(8000))
          : await db
              .rpc("staff_access_control", { p_action: action, p_actor: actor, p_data: data })
              .abortSignal(AbortSignal.timeout(8000));
    if (result.error) throw result.error;
    if (action === "directory" && !directoryResponse(result.data)) {
      throw Object.assign(Error("Invalid directory response"), { code: "STAFFRESP" });
    }
    return result.data;
  } catch (error) {
    console.warn(staffFailure(action, error));
    throw Error(staffFailureMessage(action, error));
  }
}
export async function manageStaff(action: string, actor: string, body: Record<string, unknown>) {
  if (action === "invite") {
    const origin = appOrigin(),
      email = companyEmail(body.email),
      values = assignment(body),
      department = values.departments[0];
    if (values.departments.length !== 1) throw Error("Choose one department for a new invitation.");
    if (typeof body.requestId !== "string" || !idPattern.test(body.requestId))
      throw Error("Invalid request identifier.");
    const token = randomBytes(32).toString("hex");
    const reserved = await staffRPC("invite", actor, {
      name: values.name,
      role: values.role,
      department,
      email,
      token_hash: hashInvite(token),
      request_id: body.requestId,
    });
    try {
      const db = staffAdmin();
      if (!db) throw Error("Setup unavailable");

      const type = reserved.existing_account ? "magiclink" : "invite";
      const generated = await db.auth.admin.generateLink({ type, email });
      const user = generated.data.user,
        properties = generated.data.properties;
      if (
        generated.error ||
        !user ||
        user.email?.toLowerCase() !== email ||
        !properties?.hashed_token
      )
        throw Error("Invitation generation unavailable");
      await staffRPC("bind", actor, {
        id: reserved.id,
        account_id: user.id,
        new_account: !reserved.existing_account,
      });
      const fragment = new URLSearchParams({
        invite: token,
        token_hash: properties.hashed_token,
        type,
      });
      return {
        message:
          "Invitation link created. Email delivery is not configured. Copy it now and privately share it with the intended company email owner.",
        link: `${origin}/staff/invitation#${fragment}`,
        delivery: "not_configured",
      };
    } catch {
      await staffRPC("fail", actor, { id: reserved.id }).catch(() => null);
      throw Error(
        "Invitation could not be completed. No email was sent. Refresh and revoke any pending record before retrying. An Auth account may have been created without Hub membership.",
      );
    }
  }
  if (
    !["update", "deactivate", "reactivate", "delete_member", "revoke"].includes(action) ||
    typeof body.id !== "string" ||
    !idPattern.test(body.id)
  )
    throw Error("Invalid staff action.");
  if (action !== "revoke" && (!Number.isSafeInteger(body.version) || Number(body.version) < 1))
    throw Error("Refresh this staff record before changing it.");
  if (action === "deactivate" && body.confirm !== true) throw Error("Confirm deactivation first.");
  if (action === "delete_member" && body.confirm !== true)
    throw Error("Confirm staff removal first.");
  const values = action === "update" ? assignment(body) : {};
  if (action === "update")
    await staffRPC("update_assignments", actor, { id: body.id, version: body.version, ...values });
  else await staffRPC(action, actor, { id: body.id, version: body.version, ...values });
  return {
    message:
      action === "deactivate"
        ? "Membership deactivated. Protected Hub requests will be denied; previously issued Auth tokens are not claimed to be revoked."
        : action === "delete_member"
          ? "Staff membership and department assignments removed. The sign-in identity and existing records were preserved."
          : "Staff access updated.",
    delivery: "not_configured",
  };
}
