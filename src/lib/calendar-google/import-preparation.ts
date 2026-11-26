import { createHash } from "node:crypto";
import type { GoogleEvent,GoogleMeetProvider } from "./provider";
import { incomingEvent } from "./import-model";

export async function ensureRequiredInvitations(provider:GoogleMeetProvider,event:GoogleEvent,email:string,requiredEmails:string[],removeEmails:string[]=[] ) {
 const normalized=incomingEvent(event,email);
 if(!normalized||"cancelled" in normalized)return {event,updated:false,eligible:false};
 const originalEmails=(event.attendees??[]).map(person=>person.email.toLowerCase());
 const current=new Set(originalEmails);
 const removals=new Set(removeEmails.map(value=>value.trim().toLowerCase()).filter(Boolean));
 const missing=[...new Set(requiredEmails.map(value=>value.trim().toLowerCase()).filter(value=>value&&value!==email.toLowerCase()&&!current.has(value)))];
 const kept=(event.attendees??[]).filter(person=>!removals.has(person.email.toLowerCase()));
 if(!missing.length&&!removals.size)return {event,updated:false,eligible:true,preexistingEmails:originalEmails};
 if(!event.etag||event.attendeesOmitted)return {event,updated:false,eligible:false};
 const attendees=[...kept,...missing.map(value=>({email:value,responseStatus:"needsAction"}))];
 try{
  const updated=await provider.patchEvent(event.id,event.etag,{attendees});
  const confirmed=new Set((updated.attendees??[]).map(person=>person.email.toLowerCase()));
  return {event:updated,updated:true,eligible:missing.every(value=>confirmed.has(value))&&[...removals].every(value=>!confirmed.has(value)),preexistingEmails:originalEmails};
 }catch{return {event,updated:false,eligible:false,preexistingEmails:originalEmails};}
}


export async function prepareImportedMeeting(provider:GoogleMeetProvider,event:GoogleEvent,email:string,now=Date.now()){
 let current=event;
 const normalized=incomingEvent(current,email);
 if(!normalized||"cancelled" in normalized||Date.parse(normalized.end)<=now)return {event:current,recording_status:"pending" as const};
 try{
  let url=normalized.url;
  if(!url){
   const conference=current.conferenceData;
   if(conference?.createRequest?.status?.statusCode==="pending")return {event:current,recording_status:"pending" as const};
   if(!current.etag || (conference?.conferenceSolution?.key?.type&&conference.conferenceSolution.key.type!=="hangoutsMeet"))throw Error();
   const generation=conference?.createRequest?.status?.statusCode==="failure"?current.etag:"initial";
   const requestId=createHash("sha256").update(`${email}:${current.id}:${generation}`).digest("hex").slice(0,32);
   current=await provider.patchEvent(current.id,current.etag,{conferenceData:{createRequest:{requestId,conferenceSolutionKey:{type:"hangoutsMeet"}}}});
   const prepared=incomingEvent(current,email);
   url=prepared&&!("cancelled" in prepared)?prepared.url:null;
   if(!url)return {event:current,recording_status:"pending" as const};
  }
  let space=await provider.getSpace(url.split("/").at(-1)!);
  if(!space.name || (space.meetingUri!==url&&space.meetingCode!==url.split("/").at(-1)))throw Error();
  const name=space.name;
  if(space.config?.artifactConfig?.recordingConfig?.autoRecordingGeneration!=="ON")space=await provider.configureRecording(name);
  if(space.name!==name||space.config?.artifactConfig?.recordingConfig?.autoRecordingGeneration!=="ON")throw Error();
  return {event:current,recording_status:"configured" as const};
 }catch{return {event:current,recording_status:"warning" as const}}
}
