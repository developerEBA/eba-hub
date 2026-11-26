import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { finishAuthorization, flowCookie, flowCookieOptions, googleActor, privateHeaders, safeNotice, settingsRedirect, type Notice } from "../../../../lib/google-organizer/server";
export async function GET(request: Request) {
  let notice: Notice = "forbidden";
  try {
    const actor = await googleActor(true);
    if (actor) { await finishAuthorization(actor, new URL(request.url).searchParams); notice = "connected"; }
  } catch (error) { notice = safeNotice(error); }
  (await cookies()).set(flowCookie, "", { ...flowCookieOptions, maxAge: 0 });


  const destination = settingsRedirect(notice);
  return destination ? NextResponse.redirect(destination, { status: 303, headers: privateHeaders })
    : new Response("Google setup required", { status: 503, headers: privateHeaders });
}
