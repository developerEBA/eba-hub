"use client";
import Link from "next/link";
import { useState } from "react";
import type {Meeting} from "./model";
import { meetPresentation } from "./meet-model";
import "./meet-status.css";
import { useMeetingClock } from "./use-meeting-clock";

export function MeetStatus({ meeting, organizer = false, compact = false, onChanged,now }: { meeting: Meeting; organizer?: boolean; compact?: boolean; onChanged?: () => void;now?:number }) {
  const [pending,setPending] = useState(false), [notice,setNotice] = useState("");
  const clock=useMeetingClock(now===undefined);
  const state = meetPresentation(meeting,now??clock);
  const recordingWarning = meeting.recording_status === "warning" || meeting.recording_status === "reconnect_required";
  const retry = meeting.source !== "google" && organizer && (!state.url || meeting.sync_status !== "synced" || recordingWarning) && !(meeting.status === "cancelled" && meeting.sync_status === "synced");
  async function prepare() {
    setPending(true); setNotice("");
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),110_000);
    try {
      const response = await fetch(`/dashboard/calendar/api/${meeting.id}/sync`, { method: "POST",signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error("Preparation could not finish");
      setNotice(result.message); onChanged?.();
    } catch { setNotice("Your meeting is saved. Preparation could not finish; refresh its status and retry safely."); }
    finally { clearTimeout(timer); setPending(false); }
  }
  async function confirmRecording(){
    setPending(true);setNotice("");
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55_000);
    try{
      const response=await fetch(`/dashboard/calendar/api/${meeting.id}/recording`,{method:"POST",signal:controller.signal});
      const result=await response.json();
      if(!response.ok)throw Error(result.error??"Google recording check failed.");
      setNotice(result.message);onChanged?.();
    }catch(error){setNotice(error instanceof Error?error.message:"Could not confirm Google's recording setting.")}
    finally{clearTimeout(timer);setPending(false)}
  }
  return <div className="cal-meet" data-compact={compact}>
    <div className="cal-meet__line"><span className="cal-meet__badge" data-ready={!!state.url}>{state.label}</span>
      {state.url && <a className="cal-meet__join" href={`/dashboard/calendar/api/${meeting.id}/join`} target="_blank" rel="noopener noreferrer">Join Meeting<span className="cal-visually-hidden">: {meeting.title}</span> ↗</a>}</div>
    {state.link&&!state.url&&<button type="button" className="cal-meet__join" disabled title={state.label}>Join Meeting</button>}
    {!compact && state.warning && <p className="cal-meet__warning">{state.warning}</p>}
    {!compact&&["unavailable","shared_space","retry","pending"].includes(meeting.call_end_status??"")&&<p className="cal-meet__warning">EBA joining may be closed, but Google call termination has not been confirmed. Check with the Google host.</p>}
    {meeting.status !== "cancelled" && state.url && <p className={recordingWarning ? "cal-meet__warning" : "cal-meet__recording"}>
      {meeting.recording_status === "configured" ? "Automatic recording configured" : recordingWarning ? "Recording setup needs attention" : "Automatic recording not yet confirmed"}
      {!compact && (recordingWarning ? ". Your meeting link is usable. Check Google permissions and Workspace recording policy, then retry." : ". Recording begins only when an eligible host/co-host joins on the web; it is not guaranteed.")}
    </p>}
    {!compact && meeting.source === "google" && !state.link && meeting.status === "scheduled" && <p className="cal-meet__warning">Google has not supplied a usable Meet link. The worker will prepare one for this organizer-owned meeting.</p>}
    {!compact && state.warning && /reconnect|permission/.test(meeting.link_error_code ?? "") && <Link href="/dashboard/settings">View Google connection in Settings →</Link>}
    {!compact && retry && <button className="cal-meet__retry" type="button" disabled={pending} onClick={()=>void prepare()}>{pending ? "Preparing…" : meeting.status === "cancelled" ? "Retry cancellation" : recordingWarning ? "Retry recording setup" : state.warning ? "Retry meeting setup" : "Prepare now"}</button>}
    {!compact&&state.url&&<button className="cal-meet__refresh" type="button" disabled={pending} onClick={()=>void confirmRecording()}>{pending?"Checking…":"Check recording in Google"}</button>}
    {!compact && onChanged && <button className="cal-meet__refresh" type="button" disabled={pending} onClick={onChanged}>Refresh meeting status</button>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
