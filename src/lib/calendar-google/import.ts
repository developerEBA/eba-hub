import "server-only";
import { calendarAdmin } from "../../app/dashboard/calendar/server";
import { organizerAccess } from "../google-organizer/server";
import { CalendarGoogleProvider } from "./provider";
import { incomingEvent } from "./import-model";
import { prepareImportedMeeting } from "./import-preparation";
// One durable page per worker cycle; independent of the outbound queue.
export async function runGoogleImport() {
  const empty={available:false,imported:0};
  const db=calendarAdmin(),email=process.env.GOOGLE_ORGANIZER_EMAIL;
  const ownerEmail=process.env.GOOGLE_IMPORT_OWNER_EMAIL?.trim();
  if(!db||!email)return empty;
  const deadline=Date.now()+25_000;
  const control=async(action:string,data:Record<string,unknown>={})=>{
    const result=await db.rpc("calendar_google_import",{p_action:action,p_email:email,p_data:{...data,...(ownerEmail?{owner_email:ownerEmail}:{})}})
      .abortSignal(AbortSignal.timeout(Math.max(1,Math.min(3000,deadline-Date.now()))));
    if(result.error)throw new Error("Import unavailable");return result.data;
  };
  let lease:string|undefined;
  try {
    const claim=await control("claim");
    if(!claim)return {available:true,imported:0};
    lease=claim.lease;
    const provider=new CalendarGoogleProvider(async()=> (await organizerAccess()).accessToken,deadline-3000);
    const page=await provider.listEvents(claim.from,claim.to,claim.page);
    const events:Array<Record<string,unknown>|null>=(page.items??[]).map(e=>incomingEvent(e,email)).filter(Boolean);
    // Recheck a previously imported event independently of the listing window:
    // moved/deleted events must not linger merely because they left that window.
    if(claim.check){
      const event=await provider.getEvent(claim.check);
      if(event){
        const prepared=await prepareImportedMeeting(provider,event,email);
        const incoming=incomingEvent(prepared.event,email);
        events.push(incoming?{...incoming,recording_status:prepared.recording_status}:null);
      }else events.push({id:claim.check,cancelled:true});
    }
    const result=await control("finish",{lease,events:events.filter(Boolean),page:page.nextPageToken??null});
    return {available:true,imported:Number.isSafeInteger(result?.imported)?result.imported:0};
  }catch{
    // Expiring lease permits retry. Never advance a page after partial failure.
    // Invalid page tokens reset safely; no missing-row cancellation from a scan.
    if(lease&&Date.now()<deadline)try{await control("reset",{lease})}catch{}
    return empty;
  }
}
