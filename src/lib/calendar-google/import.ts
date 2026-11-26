import "server-only";
import { calendarAdmin } from "../../app/dashboard/calendar/server";
import { organizerAccess } from "../google-organizer/server";
import { CalendarGoogleProvider } from "./provider";
import { incomingEvent } from "./import-model";
import { ensureRequiredInvitations,prepareImportedMeeting } from "./import-preparation";

export async function runGoogleImport() {
  const empty={available:false,imported:0,unsupported_external:0,invitations_pending:0};
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
    const requiredResult=await db.rpc("calendar_required_participant_emails");
    if(requiredResult.error||!Array.isArray(requiredResult.data))return empty;
    const requiredEmails=(requiredResult.data as unknown[]).filter((value):value is string=>typeof value==="string"&&/^[^@\s]+@enibrand\.com$/i.test(value));
    const claim=await control("claim");
    if(!claim)return {available:true,imported:0,unsupported_external:0,invitations_pending:0};
    lease=claim.lease;
    const provider=new CalendarGoogleProvider(async()=> (await organizerAccess()).accessToken,deadline-3000);
    const page=await provider.listEvents(claim.from,claim.to,claim.page);
    const eventIds=[...(page.items??[]).map(event=>event.id),...(claim.check?[claim.check]:[])].filter((value):value is string=>typeof value==="string");
    const deltaResult=await db.rpc("calendar_google_invitation_deltas",{p_calendar_id:email,p_event_ids:[...new Set(eventIds)]});
    if(deltaResult.error||!deltaResult.data||typeof deltaResult.data!=="object")throw new Error("Invitation delta unavailable");
    const deltas=deltaResult.data as Record<string,{remove_emails?:unknown}>;
    const removalsFor=(id:string)=>Array.isArray(deltas[id]?.remove_emails)
      ? (deltas[id].remove_emails as unknown[]).filter((value):value is string=>typeof value==="string") : [];
    const events:Array<Record<string,unknown>|null>=[];
    let unsupportedExternal=0,invitationsPending=0;
    for(const event of page.items??[]){
      if(event.extendedProperties?.private?.ebaOccurrence)continue;
      const normalized=incomingEvent(event,email);
      if(!normalized){
        if(event.status!=="cancelled"&&event.organizer?.email?.toLowerCase()!==email.toLowerCase())unsupportedExternal++;
        continue;
      }
      if("cancelled" in normalized){events.push(normalized);continue;}
      const invited=await ensureRequiredInvitations(provider,event,email,requiredEmails,removalsFor(event.id));
      if(!invited.eligible){invitationsPending++;continue;}
      const imported=incomingEvent(invited.event,email);
      events.push(imported&&!("cancelled" in imported)?{...imported,preexisting_attendees:invited.preexistingEmails??[]}:imported);
    }


    if(claim.check){
      const event=await provider.getEvent(claim.check);
      if(event){
        const alreadyCancelled=incomingEvent(event,email);
        if(alreadyCancelled&&"cancelled" in alreadyCancelled){events.push(alreadyCancelled);}
        else {
         const invited=await ensureRequiredInvitations(provider,event,email,requiredEmails,removalsFor(event.id));
         if(invited.eligible){
          const prepared=await prepareImportedMeeting(provider,invited.event,email);
          const incoming=incomingEvent(prepared.event,email);
          events.push(incoming&&!("cancelled" in incoming)?{...incoming,recording_status:prepared.recording_status,preexisting_attendees:invited.preexistingEmails??[]}:incoming);
         }else invitationsPending++;
        }
      }else events.push({id:claim.check,cancelled:true});
    }
    const result=await control("finish",{lease,events:events.filter(Boolean),page:invitationsPending?claim.page:page.nextPageToken??null});
    return {available:true,imported:Number.isSafeInteger(result?.imported)?result.imported:0,
      unsupported_external:unsupportedExternal,invitations_pending:invitationsPending};
  }catch{


    if(lease&&Date.now()<deadline)try{await control("reset",{lease})}catch{}
    return empty;
  }
}
