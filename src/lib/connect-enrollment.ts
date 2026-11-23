import "server-only";
import { createClient } from "@supabase/supabase-js";

export async function recordConnectSignIn(userId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return;

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.rpc("connect_record_sign_in", { person: userId });
}
