import { cookies } from "next/headers";
import { createSupabaseClient, staffSessionCookie } from "./supabase-client";

export async function createStaffClient() {
  return createSessionClient(staffSessionCookie);
}

export async function createSessionClient(cookieName: string) {
  const store = await cookies();

  return createSupabaseClient({
    getAll: () => store.getAll(),
    setAll(entries) {
      try {
        for (const { name, value, options } of entries) store.set(name, value, options);
      } catch {
        // Server Components cannot write cookies. The dashboard proxy refreshes them.
      }
    },
  }, cookieName);
}

export async function clearStaffSession(
  client: NonNullable<Awaited<ReturnType<typeof createStaffClient>>>,
  cookieName = staffSessionCookie,
) {
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // Local cleanup still runs if the auth service is unavailable.
  } finally {
    // Clear local cookies even if the auth service cannot revoke the session.
    const store = await cookies();
    for (const { name } of store.getAll()) {
      if (name === cookieName || name.startsWith(cookieName + ".")) {
        store.delete(name);
      }
    }
  }
}

export async function getStaffRole(
  client: NonNullable<Awaited<ReturnType<typeof createStaffClient>>>,
  user: { id: string; email?: string },
): Promise<"CEO" | "Admin" | null> {
  if (!user.email || !/^[^@]+@enibrand\.com$/i.test(user.email)) return null;

  const { data, error } = await client
    .from("staff_memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error || (data?.role !== "ceo" && data?.role !== "admin")) return null;
  return data.role === "ceo" ? "CEO" : "Admin";
}
