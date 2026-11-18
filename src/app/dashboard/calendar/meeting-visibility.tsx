"use client";
import { useState } from "react";
import type { Meeting } from "./model";
export function MeetingVisibility({meeting,canChange,onChanged}:{meeting:Meeting;canChange:boolean;onChanged?:()=>void}){
 const [audience,setAudience]=useState(meeting.audience??"private"),[pending,setPending]=useState(false),[notice,setNotice]=useState("");
 async function save(){
  setPending(true);setNotice("");
  try{const response=await fetch(`/dashboard/calendar/api/${meeting.id}/audience`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({audience,version:meeting.audience_version??1})});
   if(!response.ok)throw Error();setNotice("Visibility updated.");onChanged?.();
  }catch{setNotice("Could not update visibility. Refresh the meeting and check migration setup.")}
  finally{setPending(false)}
 }
 return <section className="cal-meet"><strong>Meeting classification</strong>{canChange?<>
  <label className="cal-field">Audience<select value={audience} disabled={pending} onChange={e=>setAudience(e.target.value as NonNullable<Meeting["audience"]>)}>
   <option value="private">Restricted — CEO, Admin and invitees</option><option value="company">Company meeting</option>
   <option value="general">General meeting</option><option value="leadership">HOD / Leadership meeting</option>
  </select></label><p>All meetings include CEO and Admin access. HOD and employee dashboards remain unconfigured.</p>
  <button type="button" className="cal-meet__retry" disabled={pending} onClick={()=>void save()}>{pending?"Saving…":"Save classification"}</button>
 </>:<p>All meetings are visible to active CEO and Admin accounts.</p>}{notice&&<p role="status">{notice}</p>}</section>;
}
