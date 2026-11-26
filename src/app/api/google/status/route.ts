import { connectionStatus, googleActor, privateHeaders } from "../../../../lib/google-organizer/server";
export async function GET() {
  const actor = await googleActor();
  if (!actor) return Response.json({ error: "Forbidden" }, { status: 403, headers: privateHeaders });


  return Response.json(await connectionStatus(false), { headers: privateHeaders });
}
