import { NextResponse } from "next/server";
import { disconnectOrganizer, googleActor, privateHeaders, sameOrigin, safeNotice, settingsRedirect } from "../../../../lib/google-organizer/server";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403, headers: privateHeaders });
  const actor = await googleActor(true);
  if (!actor) return new Response("Forbidden", { status: 403, headers: privateHeaders });
  let notice;
  try { notice = await disconnectOrganizer(actor); } catch (error) { notice = safeNotice(error); }
  const destination = settingsRedirect(notice);
  return destination ? NextResponse.redirect(destination, { status: 303, headers: privateHeaders })
    : new Response("Google setup required", { status: 503, headers: privateHeaders });
}
