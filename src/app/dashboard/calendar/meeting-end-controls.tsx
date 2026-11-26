"use client";
import { useEffect,useRef,useState } from "react";
import type { Meeting } from "./model";
import { joinWindow } from "./join-window";
import { useMeetingClock } from "./use-meeting-clock";
const endLabels={pending:"Google termination pending",retry:"Google termination failed temporarily — retry scheduled",ended:"Observed Google call confirmed ended",no_active_call:"Google reported no active call",unavailable:"Google termination failed or unavailable — use Google host controls",shared_space:"Google termination blocked: another occurrence uses this link",reconnect_required:"Reconnect Google required — authorize call-ending permission in Settings, then retry",not_requested:""};
function EndConfirmation({pending,onConfirm,onCancel}:{pending:boolean;onConfirm:()=>void;onCancel:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close()},[]);
 return <dialog ref={dialog} className="cal-end-confirm" aria-labelledby="end-call-title" aria-describedby="end-call-description" onCancel={event=>{event.preventDefault();if(!pending)onCancel()}} onKeyDown={event=>{
  if(event.key!=="Tab")return;
  const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
  const first=buttons[0],last=buttons[buttons.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
 }}>
  <h3 id="end-call-title">End meeting for everyone?</h3>
  <p id="end-call-description">All participants will be disconnected if Google accepts this request. EBA joining closes immediately for this occurrence. Google may deny termination; previously shared Google links may still allow re-entry.</p>
  <button type="button" className="cal-meet__refresh" autoFocus disabled={pending} onClick={onCancel}>Keep meeting open</button>
  <button type="button" className="cal-meet__retry" disabled={pending} onClick={onConfirm}>{pending?"Requesting…":"Confirm end for everyone"}</button>
 </dialog>;
}
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
 if(meeting.end_permission!=="eligible")return <section className="cal-meet"><strong>End meeting for everyone unavailable</strong><p>{meeting.end_permission==="foreign_owner"?"This meeting belongs to another Google organizer.":meeting.end_permission==="not_manager"?"Only the authorized Admin organizer manages this occurrence.":"Meeting ownership must be verified before ending a call."}</p></section>;
 return <section className="cal-meet"><strong>Admin meeting controls</strong>
  <p>Joining closes three hours after the scheduled end. Closing EBA joining and ending a Google call are separate operations.</p>
  {meeting.call_end_status&&endLabels[meeting.call_end_status]&&<p role="status">{endLabels[meeting.call_end_status]}</p>}
  {confirm&&<EndConfirmation pending={pending} onConfirm={()=>void end()} onCancel={()=>setConfirm(false)}/>}
  <button type="button" className="cal-meet__retry" disabled={window.state==="waiting"||pending||["ended","no_active_call"].includes(meeting.call_end_status??"")} onClick={()=>setConfirm(true)}>{meeting.joining_closed_at?"Retry Google end request":"End meeting for everyone…"}</button>
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
