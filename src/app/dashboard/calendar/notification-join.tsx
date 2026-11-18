"use client";
import { joinWindow } from "./join-window";
import { useMeetingClock } from "./use-meeting-clock";
export function NotificationJoin({meeting}:{meeting:{id:string;starts_at:string;ends_at:string;status:"scheduled"|"cancelled";joining_closed_at?:string|null}}){
 const now=useMeetingClock(),window=joinWindow(meeting,now);
 return window.state==="open"?<a href={`/dashboard/calendar/api/${meeting.id}/join`} target="_blank" rel="noopener noreferrer">Join Meeting ↗</a>
  :<button type="button" disabled title={window.state==="waiting"?"Opens at scheduled start":"Joining closed for this occurrence"}>Join Meeting</button>;
}
