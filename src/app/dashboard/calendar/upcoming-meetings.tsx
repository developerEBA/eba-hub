"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { meetingDate, type Meeting, type MeetingPerson } from "./model";
import { meetPresentation } from "./meet-model";
import { useMeetingClock } from "./use-meeting-clock";

type Data = { meetings: Meeting[]; ready: boolean; error: string | null; people?:MeetingPerson[];truncated?:boolean };
const timeFormat=new Intl.DateTimeFormat("en-US",{timeZone:"Africa/Lagos",hour:"numeric",minute:"2-digit",hour12:true});
const cardTime=(value:string)=>timeFormat.format(new Date(value));
function ParticipantAvatar({person}:{person?:MeetingPerson}){
  const [failed,setFailed]=useState(false);
  const initials=person?.display_name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join("").toUpperCase();
  return <span className="overview-meeting__avatar" title={person?.display_name??"Meeting participant"}>
    {person?.avatar_url&&/^https:\/\//.test(person.avatar_url)&&!failed?<Image src={person.avatar_url} alt="" width={25} height={25} unoptimized onError={()=>setFailed(true)}/>:initials||<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>}
  </span>;
}
export function UpcomingMeetings({ initial }: { initial: Data }) {
  const now=useMeetingClock();
  const [data, setData] = useState(initial);
  useEffect(() => {
    let busy = false, active = true;
    const controller = new AbortController();
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch("/dashboard/calendar/api?view=today&people=1", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (active && Array.isArray(result.meetings)) setData(result);
      } catch { /* Preserve the latest authorized summary through a short outage. */ }
      finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    const resume = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, []);
  return <><p className="overview-meetings__subtitle">Today’s schedule · Lagos time</p>{!data.ready ? <p role="status">{data.error}</p> : !data.meetings.length ? <p className="overview-meetings__empty">No meetings today. Your next plan starts here.</p> : <ul className="overview-meetings" aria-label="Today’s meetings">{data.meetings.map(meeting=>{
    const state=meetPresentation(meeting,now);
    const ids=[...new Set([meeting.organizer_id,...(meeting.attendee_ids??[])].filter(Boolean))];
    const recording=meeting.recording_status==="configured"?"Automatic recording configured":["warning","reconnect_required"].includes(meeting.recording_status??"")?"Recording setup needs attention":"Automatic recording not yet confirmed";
    return <li key={meeting.id} className="overview-meeting">
      <Link className="overview-meeting__details" href={`/dashboard/calendar?meeting=${meeting.id}`} prefetch={false} title={meeting.title}>
        <strong>{meeting.title}</strong><span>Today, {cardTime(meeting.starts_at)}{meeting.ends_at?` – ${cardTime(meeting.ends_at)}`:""}</span>
        <span className="overview-meeting__sr">{meetingDate(meeting.starts_at)} · Africa/Lagos</span>
      </Link>
      <div className="overview-meeting__people" aria-label={`${ids.length} participant${ids.length===1?"":"s"}`}>
        {ids.slice(0,3).map(id=><ParticipantAvatar key={id} person={data.people?.find(person=>person.user_id===id)}/>)}
        {ids.length>3&&<span className="overview-meeting__more">+{ids.length-3}</span>}
      </div>
      <div className="overview-meeting__action" data-ready={!!state.url} title={state.url?recording:state.label}>
        <svg className="overview-meeting__camera" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2" y="5" width="13" height="14" rx="3"/><path d="m16 9 5-3v12l-5-3z"/></svg>
        {state.url?<a className="overview-meeting__join" href={`/dashboard/calendar/api/${meeting.id}/join`} target="_blank" rel="noopener noreferrer" aria-label={`Join Meeting: ${meeting.title}`}>Join Meeting</a>
          :state.link?<button className="overview-meeting__pending" type="button" disabled title={state.label}>Join Meeting</button>
          :<Link className="overview-meeting__pending" href={`/dashboard/calendar?meeting=${meeting.id}`} prefetch={false}>{meeting.source==="google"?"Link pending":"Setup pending"}</Link>}
        <span className="overview-meeting__sr">{state.url?recording:state.label}</span>
      </div>
    </li>;
  })}</ul>}{data.truncated&&<p className="overview-meetings__subtitle">First 200 shown. View All to explore your calendar.</p>}</>;
}
