import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";

export const staffSessionCookie = "eba-staff-session";
export const portalSessionCookie = "eba-client-session";

export function createSupabaseClient(cookies: CookieMethodsServer, cookieName = staffSessionCookie) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  return createServerClient(url, key, {
    cookieOptions: {
      name: cookieName,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    },
    cookies,
  });
}
