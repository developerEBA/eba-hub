import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!getSupabaseConfig() || !process.env.APP_URL)
    return NextResponse.json(
      { error: "Authentication setup required." },
      { status: 503 },
    );
  const appUrl = new URL(process.env.APP_URL);
  const failure = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, appUrl));
  if (!code) return failure("provider");
  const db = await createClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) return failure("provider");
  const {
    data: { user },
    error: userError,
  } = await db.auth.getUser();
  if (userError || !user) return failure("provider");
  const { data: profile, error: profileError } = await db
    .from("employee_profiles")
    .select("id")
    .eq("id", user.id)
    .eq("is_active", true)
    .single();
  if (profileError || !profile) {
    await db.auth.signOut();
    return failure("membership");
  }
  return NextResponse.redirect(new URL("/dashboard", appUrl));
}
