"use client";
import { useState } from "react";
import type { Meeting } from "./model";
import { joinWindow } from "./join-window";
import { useMeetingClock } from "./use-meeting-clock";
const endLabels={pending:"Google termination pending",retry:"Google termination not yet confirmed",ended:"Observed Google call ended",no_active_call:"Google reported no active call",unavailable:"Google termination unavailable — use Google host controls",shared_space:"Google termination blocked: another occurrence uses this link",not_requested:""};
export function MeetingEndControls({meeting,onChanged}:{meeting:Meeting;onChanged?:()=>void}){
 const [confirm,setConfirm]=useState(false),[pending,setPending]=useState(false),[notice,setNotice]=useState("");
 const now=useMeetingClock(),window=joinWindow(meeting,now);
 async function end(){
  setPending(true);setNotice("");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55_000);
  try{const response=await fetch(`/dashboard/calendar/api/${meeting.id}/end`,{method:"POST",signal:controller.signal});
   const result=await response.json();if(!response.ok)throw Error(result.error??"Ending could not be requested.");
   setNotice(result.message);setConfirm(false);onChanged?.();
  }catch(error){setNotice(error instanceof Error?error.message:"Google termination could not be confirmed. Refresh this occurrence.")}
  finally{clearTimeout(timer);setPending(false)}
 }
 if(meeting.status==="cancelled")return null;
 return <section className="cal-meet"><strong>Admin meeting controls</strong>
  <p>Joining closes three hours after the scheduled end. Closing EBA joining and ending a Google call are separate operations.</p>
  {meeting.call_end_status&&endLabels[meeting.call_end_status]&&<p role="status">{endLabels[meeting.call_end_status]}</p>}
  {confirm?<div className="cal-meet__warning"><p>Close joining for this occurrence and request Google end the active call for everyone? Google may deny this operation; EBA will report the result.</p>
    <button type="button" className="cal-meet__retry" disabled={pending} onClick={()=>void end()}>{pending?"Requesting…":"Confirm end request"}</button>
    <button type="button" className="cal-meet__refresh" disabled={pending} onClick={()=>setConfirm(false)}>Keep meeting open</button>
  </div>:<button type="button" className="cal-meet__retry" disabled={window.state==="waiting"||pending} onClick={()=>setConfirm(true)}>{meeting.joining_closed_at?"Retry Google end request":"End meeting for everyone…"}</button>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
