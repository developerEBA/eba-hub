import { createHash } from "node:crypto";
import type { GoogleEvent,GoogleMeetProvider } from "./provider";
import { incomingEvent } from "./import-model";
// Only the worker's already-imported, organizer-owned event is eligible. Never
// create a replacement event or change guests/title/time. ETags protect edits.
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
