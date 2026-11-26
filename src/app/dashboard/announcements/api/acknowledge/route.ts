import { NextResponse } from "next/server";
import { requireHodDashboardAccess } from "../../../access";

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).origin !== new URL(request.url).origin) return NextResponse.json({ error: "Request unavailable." }, { status: 403 });
    let input: unknown;
    try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid acknowledgement." }, { status: 400 }); }
    if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid acknowledgement." }, { status: 400 });
    const { id, revision } = input as { id?: unknown; revision?: unknown };
    if (typeof id !== "string" || !/^[\da-f-]{36}$/i.test(id) || !Number.isInteger(revision) || Number(revision) < 1)
      return NextResponse.json({ error: "Invalid acknowledgement." }, { status: 400 });
    const { client } = await requireHodDashboardAccess();
    const { data, error } = await client.rpc("announcement_acknowledge", { p_id: id, p_revision: revision });
    if (error || data !== true) return NextResponse.json({ error: "This announcement is no longer available. Refresh to retry." }, { status: 409 });
    return NextResponse.json({ acknowledged: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Acknowledgement could not be saved." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
}
