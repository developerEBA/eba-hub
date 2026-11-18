import { NextResponse } from "next/server";
import { beginAuthorization, googleActor, privateHeaders, sameOrigin, safeNotice, settingsRedirect } from "../../../../lib/google-organizer/server";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403, headers: privateHeaders });
  const actor = await googleActor(true);
  if (!actor) return new Response("Forbidden", { status: 403, headers: privateHeaders });
  try { return NextResponse.redirect(await beginAuthorization(actor), { status: 303, headers: privateHeaders }); }
  catch (error) {
    const destination = settingsRedirect(safeNotice(error));
    return destination ? NextResponse.redirect(destination, { status: 303, headers: privateHeaders })
      : new Response("Google setup required", { status: 503, headers: privateHeaders });
  }
}
