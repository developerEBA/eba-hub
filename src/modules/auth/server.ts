import "server-only";
import { redirect } from "next/navigation";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { isWorkspaceRole, type WorkspaceRole } from "./permissions";
export async function requireWorkspaceSession() {
  if (!getSupabaseConfig()) {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.EBA_SETUP_PREVIEW !== "true"
    )
      redirect("/login");
    return { preview: true as const };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  const { data: profile, error: profileError } = await supabase
    .from("employee_profiles")
    .select("id, role, display_name")
    .eq("id", data.claims.sub)
    .eq("is_active", true)
    .single();
  if (profileError || !profile || !isWorkspaceRole(profile.role))
    redirect("/login");
  return {
    preview: false as const,
    userId: profile.id as string,
    role: profile.role,
    displayName: String(profile.display_name),
  };
}
/** Required at every privileged action/query entry point; preview never grants access. */
export async function requireWorkspaceRole(allowed: readonly WorkspaceRole[]) {
  const session = await requireWorkspaceSession();
  if (session.preview || !allowed.includes(session.role))
    throw new Error("Forbidden");
  return session;
}
