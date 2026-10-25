"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
export async function signInWithGoogle() {
  if (!getSupabaseConfig() || !process.env.APP_URL)
    redirect("/login?error=setup");
  const origin = new URL(process.env.APP_URL);
  if (
    origin.protocol !== "https:" &&
    !(
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(origin.hostname)
    )
  )
    redirect("/login?error=setup");
  const db = await createClient();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL("/auth/callback", origin).toString(),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/login?error=provider");
  redirect(data.url);
}
export async function signOut() {
  if (getSupabaseConfig()) {
    const db = await createClient();
    const { error } = await db.auth.signOut();
    if (error) redirect("/login?error=signout");
  }
  redirect("/login");
}
