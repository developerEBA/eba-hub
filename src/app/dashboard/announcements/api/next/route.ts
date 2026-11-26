import { NextResponse } from "next/server";
import { requireHodDashboardAccess } from "../../../access";

export async function GET() {
  try {
    const { client } = await requireHodDashboardAccess();
    const { data, error } = await client.rpc("announcement_next");
    if (error) return NextResponse.json({ error: "Announcements unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ announcement: data ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Announcements unavailable." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
}
