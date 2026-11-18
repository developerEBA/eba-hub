import "server-only";
import { calendarAdmin } from "../../app/dashboard/calendar/server";
import { organizerAccess } from "../google-organizer/server";
import { CalendarGoogleProvider,GoogleHttpError,type GoogleEvent,type GoogleSpace } from "./provider";
import { joinWindow } from "../../app/dashboard/calendar/join-window";
import { validMeetUrl } from "../../app/dashboard/calendar/meet-model";
import type { Meeting } from "../../app/dashboard/calendar/model";
type EndState="ended"|"no_active_call"|"retry"|"unavailable"|"shared_space";
export type EndClaim={meeting:Meeting&{provider_event_id?:string;provider_calendar_id?:string};job:{lease:string;space_name?:string;conference_record?:string}};
export interface CallEndProvider{
 getEvent(id:string):Promise<GoogleEvent|null>;getSpace(id:string):Promise<GoogleSpace>;
 getConferenceRecord(id:string):Promise<{name?:string;startTime?:string;endTime?:string}>;
 endActiveConference(name:string):Promise<unknown>;
}
export async function endClaim(claim:EndClaim,provider:CallEndProvider,email:string,
 control:(action:string,data?:Record<string,unknown>)=>Promise<{valid?:boolean;conflict?:boolean}|null>,now=Date.now()){
 const m=claim.meeting,job=claim.job;
 const finish=async(state:EndState,reason:string)=>{await control("finish",{state,reason});return state};
 try{
  if(!validMeetUrl(m.join_url)||m.provider_calendar_id!==email||!m.provider_event_id)return await finish("unavailable","identity_unavailable");
  let current=await control("assert");
  if(current?.conflict)return await finish("shared_space","another_occurrence_open");
  if(!current?.valid)return "retry";
  const event=await provider.getEvent(m.provider_event_id);
  const links=[event?.hangoutLink,...(event?.conferenceData?.entryPoints??[]).filter(p=>p.entryPointType==="video").map(p=>p.uri)];
  if(!event||event.status==="cancelled"||event.organizer?.email!==email||!links.includes(m.join_url))return await finish("unavailable","event_changed");
  let space=await provider.getSpace(job.space_name??m.join_url.split("/").at(-1)!);
  if(!space.name||(space.meetingUri!==m.join_url&&space.meetingCode!==m.join_url.split("/").at(-1)))return await finish("unavailable","space_mismatch");
  const active=space.activeConference?.conferenceRecord;
  if(!active)return await finish(job.conference_record?"ended":"no_active_call","no_active_conference_reported");
  if(job.conference_record&&active!==job.conference_record)return await finish("ended","previous_conference_no_longer_active");
  if(!job.conference_record){
   const record=await provider.getConferenceRecord(active),window=joinWindow(m,now),started=Date.parse(record.startTime??"");
   if(record.name!==active||!Number.isFinite(started)||started<window.opens||started>=window.closes||record.endTime)return await finish("unavailable","conference_outside_occurrence_window");
   const bound=await control("bind",{space:space.name,conference:active});
   if(bound?.conflict)return await finish("shared_space","another_occurrence_open");
   if(!bound?.valid)return "retry";
  }
  current=await control("assert");
  if(current?.conflict)return await finish("shared_space","another_occurrence_open");
  if(!current?.valid)return "retry";
  // Google exposes no compare-and-swap conference parameter for this method.
  // Bind identity and immediately re-read to reduce replacement-conference risk.
  space=await provider.getSpace(space.name);
  if(space.activeConference?.conferenceRecord!==active)return await finish("ended","observed_conference_no_longer_active");
  await provider.endActiveConference(space.name!);
  const after=await provider.getSpace(space.name!);
  return await finish(after.activeConference?.conferenceRecord===active?"retry":"ended",
    after.activeConference?.conferenceRecord===active?"termination_not_yet_confirmed":"termination_confirmed");
 }catch(error){
  const denied=error instanceof GoogleHttpError&&[401,403].includes(error.status);
  return await finish(denied?"unavailable":"retry",denied?"google_permission_required":"provider_unavailable");
 }
}
export async function runCallEnding(id?:string){
 const db=calendarAdmin(),email=process.env.GOOGLE_ORGANIZER_EMAIL;
 const empty={available:false,processed:0,ended:0};if(!db||!email)return empty;
 const deadline=Date.now()+20_000;
 let claim:EndClaim|null=null;
 const rpc=async(action:string,data:Record<string,unknown>={})=>{
  const result=await db.rpc("calendar_call_end_control",{p_action:action,p_id:claim?.meeting.id??id??null,p_lease:claim?.job.lease??null,p_data:data}).abortSignal(AbortSignal.timeout(3000));
  if(result.error)throw Error("Call-ending setup unavailable");return result.data;
 };
 try{
  // Avoid refreshing Google credentials on every idle worker tick.
  let query=db.from("calendar_call_end_jobs").select("occurrence_id").lte("next_attempt_at",new Date().toISOString())
   .in("state",["pending","retry","unavailable","processing"]).limit(1);
  if(id)query=query.eq("occurrence_id",id);
  const due=await query.abortSignal(AbortSignal.timeout(3000));
  if(due.error)return empty;if(!due.data?.length)return {...empty,available:true};
  const enabled=process.env.GOOGLE_MEET_CALL_ENDING_ENABLED==="true";
  const access=enabled?await organizerAccess():null;
  if(Date.now()>deadline-4000)return empty;
  claim=await rpc("claim") as EndClaim|null;
  if(!claim)return {...empty,available:true};
  if(!enabled||!access?.callEndingAuthorized){
   await rpc("finish",{state:"unavailable",reason:enabled?"additional_authorization_required":"call_ending_not_enabled"});
   return {available:true,processed:1,ended:0};
  }
  const provider=new CalendarGoogleProvider(async()=>{
   const check=await db.from("google_organizer_connection").select("enabled,version,email").eq("singleton",true).single();
   if(!check.data?.enabled||check.data.version!==access.version||check.data.email!==email)throw new GoogleHttpError(401);
   return access.accessToken;
  },Math.min(deadline-3000,Date.now()+12_000));
  const state=await endClaim(claim,provider,email,rpc);
  return {available:true,processed:1,ended:state==="ended"?1:0};
 }catch{
  if(claim)try{await rpc("finish",{state:"retry",reason:"provider_unavailable"})}catch{}
  return empty;
 }
}
