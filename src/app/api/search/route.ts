import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  if (!getSupabaseConfig())
    return NextResponse.json(
      { error: "Search requires Supabase setup." },
      { status: 503 },
    );
  const q = z
    .string()
    .trim()
    .min(2)
    .max(80)
    .safeParse(new URL(request.url).searchParams.get("q"));
  if (!q.success)
    return NextResponse.json(
      { error: "Enter between 2 and 80 characters." },
      { status: 400 },
    );
  const db = await createClient();
  const { data: claims, error: authError } = await db.auth.getClaims();
  if (authError || !claims?.claims?.sub)
    return NextResponse.json({ error: "Sign in to search." }, { status: 401 });
  const { data: profile } = await db
    .from("employee_profiles")
    .select("id")
    .eq("id", claims.claims.sub)
    .single();
  if (!profile)
    return NextResponse.json(
      { error: "Employee access required." },
      { status: 403 },
    );
  const term = `%${q.data.replace(/[\\%_]/g, "\\$&")}%`;
  const results = await Promise.all([
    db.from("tasks").select("id,title").ilike("title", term).limit(8),
    db.from("projects").select("id,name").ilike("name", term).limit(8),
    db
      .from("employee_profiles")
      .select("id,display_name")
      .ilike("display_name", term)
      .limit(8),
    db
      .from("messages")
      .select("id,body,conversation_id")
      .ilike("body", term)
      .limit(8),
    db.from("workspace_files").select("id,name").ilike("name", term).limit(8),
  ]);
  if (results.some((result) => result.error))
    return NextResponse.json(
      { error: "Search failed. Check database setup and permissions." },
      { status: 503 },
    );
  const [tasks, projects, people, messages, files] = results;
  return NextResponse.json(
    {
      results: [
        ...(tasks.data ?? []).map((r) => ({
          kind: "Task",
          title: r.title,
          href: `/dashboard/tasks?q=${encodeURIComponent(q.data)}`,
        })),
        ...(projects.data ?? []).map((r) => ({
          kind: "Project",
          title: r.name,
          href: "/dashboard/projects",
        })),
        ...(people.data ?? []).map((r) => ({
          kind: "Employee",
          title: r.display_name,
          href: "/dashboard/directory",
        })),
        ...(messages.data ?? []).map((r) => ({
          kind: "Message",
          title: r.body.slice(0, 100),
          href: `/dashboard/chat?conversation=${r.conversation_id}`,
        })),
        ...(files.data ?? []).map((r) => ({
          kind: "File",
          title: r.name,
          href: "/dashboard/files",
        })),
      ],
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
