import "server-only";
import { createStaffClient, getActiveAccountRole, type ActiveAccountRole } from "../staff-auth";
import { staffAdmin } from "../staff-access/server";

export const accountHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function accountActor() {
  const client = await createStaffClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const role: ActiveAccountRole | null = await getActiveAccountRole(client, data.user);
  return role ? { client, user: data.user, role } : null;
}

export function profileAdmin() {
  return staffAdmin();
}

export function validDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 120 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
}

export function validCompanyEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^@\s]+@enibrand\.com$/i.test(value.trim());
}

export const profilePhotoPath = (userId: string) => `/account/profile/photo/${userId}`;
