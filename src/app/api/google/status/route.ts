import { connectionStatus, googleActor, privateHeaders } from "../../../../lib/google-organizer/server";
export async function GET() {
  const actor = await googleActor();
  if (!actor) return Response.json({ error: "Forbidden" }, { status: 403, headers: privateHeaders });
  // Status reads must never refresh or persist organizer credentials. A separate,
  // deliberate integration check can be added without coupling it to page load.
  return Response.json(await connectionStatus(false), { headers: privateHeaders });
}
