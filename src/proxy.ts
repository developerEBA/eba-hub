import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseClient, portalSessionCookie, staffSessionCookie } from "./lib/supabase-client";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const client = createSupabaseClient({
    getAll: () => request.cookies.getAll(),
    setAll(entries, headers) {
      for (const { name, value } of entries) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of entries) response.cookies.set(name, value, options);
      for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
    },
  }, request.nextUrl.pathname.startsWith("/client/") ? portalSessionCookie : staffSessionCookie);

  await client?.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/client/sign-in", "/client/portal/:path*"],
};
