import type { GoogleEvent } from "./provider";
import { validMeetUrl } from "../../app/dashboard/calendar/meet-model";
export function incomingEvent(event:GoogleEvent,email:string) {
  if(!event.id || event.extendedProperties?.private?.ebaOccurrence)return null;
  if(event.status==="cancelled")return {id:event.id,cancelled:true};
  const start=event.start?.dateTime,end=event.end?.dateTime;


  if(event.organizer?.email?.toLowerCase()!==email.toLowerCase())return null;
  if(event.attendeesOmitted || !start || !end
    || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))
    || Date.parse(end)<=Date.parse(start) || Date.parse(end)-Date.parse(start)>86400000)return {id:event.id,cancelled:true};
  const url=[event.hangoutLink,...(event.conferenceData?.entryPoints??[]).filter(p=>p.entryPointType==="video").map(p=>p.uri)].find(validMeetUrl)??null;
  return {id:event.id,title:(event.summary?.trim()||"Untitled Google meeting").slice(0,160),agenda:event.description?.slice(0,4000)??null,
    start,end,url,attendees:(event.attendees??[]).filter(a=>a.responseStatus!=="declined").map(a=>a.email.toLowerCase())};
}
