"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, lagosDate, lagosToISO, meetingDate, meetingTime, viewRange, type CalendarView, type Directory, type Meeting } from "./model";
import { MeetingDialog } from "./meeting-dialog";
import { MeetStatus } from "./meet-status";
import { useMeetingClock } from "./use-meeting-clock";

type CalendarData = { meetings: Meeting[]; ready: boolean; error: string | null; truncated: boolean };
export function CalendarClient({ userId, initial, directory, initialMeetingId,canEnd=false,canSchedule=true,canEditMeetings=true }: { userId: string; initial: CalendarData; directory: Directory; initialMeetingId?: string;canEnd?:boolean;canSchedule?:boolean;canEditMeetings?:boolean }) {
  const now=useMeetingClock();
  const router = useRouter();
  const [view, setView] = useState<CalendarView>("week"), [data, setData] = useState(initial), [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<Meeting | "create" | null>(null), [notice, setNotice] = useState(""), [opening, setOpening] = useState<string | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const [savedMeetingId,setSavedMeetingId] = useState<string | null>(null);
  useEffect(() => {
    let active = true, busy = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(`/dashboard/calendar/api?view=${view}`, { cache: "no-store", signal: controller.signal });
        const next = await response.json();
        if (!active) return;
        if (response.ok || Array.isArray(next.meetings)) setData(next);
        else setNotice(next.error ?? "Calendar could not refresh.");
      } catch { if (active) setNotice("Calendar couldn’t refresh. Check your connection."); }
      finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    const resume = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [view, refreshKey]);
  const openMeeting = useCallback(async (id: string) => {
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller; setOpening(id); setNotice("");
    try {
      const response = await fetch(`/dashboard/calendar/api/${id}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Meeting unavailable.");
      if (!controller.signal.aborted) setDialog(result);
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Meeting could not be opened."); }
    finally { if (!controller.signal.aborted) setOpening(null); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { if (initialMeetingId) void openMeeting(initialMeetingId); }, 0);
    return () => { clearTimeout(timer); detailRequest.current?.abort(); };
  }, [initialMeetingId, openMeeting]);
  const detailId=dialog&&typeof dialog!=="string"?dialog.id:null;
  useEffect(()=>{
    if(!detailId)return;
    let busy=false;const controller=new AbortController();
    const refresh=async()=>{if(busy||document.hidden)return;busy=true;try{
      const response=await fetch(`/dashboard/calendar/api/${detailId}`,{cache:"no-store",signal:controller.signal});
      if(response.ok){const next=await response.json();if(!controller.signal.aborted)setDialog(current=>current&&typeof current!=="string"&&current.id===detailId?next:current)}
      else if([401,403,404].includes(response.status)){setDialog(null);setNotice("Meeting access is no longer available.")}
    }catch{/* Existing detail remains; protected operations recheck access. */}finally{busy=false}};
    const timer=setInterval(()=>void refresh(),15000);window.addEventListener("focus",refresh);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener("focus",refresh)};
  },[detailId]);
  const range = viewRange(view), today = lagosDate();
  const days = Array.from({ length: 7 }, (_, index) => addDays(range.start, index));
  const canAdd = canSchedule && data.ready && directory.ready;
  const entry = (meeting: Meeting) => <div className="cal-meeting-wrap" key={meeting.id}><button type="button" className="cal-meeting" data-meeting-id={meeting.id} onClick={() => void openMeeting(meeting.id)} disabled={opening === meeting.id} aria-label={`View ${meeting.title}, ${meetingDate(meeting.starts_at)} at ${meetingTime(meeting.starts_at)}`}>
    <span className="cal-meeting__time">{meetingTime(meeting.starts_at)}–{meetingTime(meeting.ends_at)}</span><strong>{meeting.title}</strong><span>{meeting.organizer_id === userId ? "Organizing" : "Invited"}{meeting.frequency === "weekly" ? " · Weekly" : ""}</span>
  </button><MeetStatus meeting={meeting} compact now={now}/></div>;
  return <section className="eba-calendar" aria-labelledby="calendar-title">
    <header className="cal-heading"><div><h1 id="calendar-title">Calendar</h1><p>Good work starts with time together.</p></div><button type="button" className="cal-primary" disabled={!canAdd} onClick={() => { setNotice(""); setDialog("create"); }}>＋ Add Meeting</button></header>
    <div className="cal-toolbar"><nav aria-label="Calendar views">{([["week","This Week"],["next","Next Week"],["upcoming","Upcoming"]] as const).map(([key,label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</nav><span>Africa/Lagos · WAT (UTC+1)</span><button className="cal-refresh" type="button" onClick={() => { setRefreshKey((value) => value + 1); router.refresh(); }}>Refresh</button></div>
    {(!data.ready || !directory.ready) && <p className="cal-alert" role="status">{data.error ?? "Calendar staff directory setup pending. Confirm the migration and server configuration."}</p>}
    {notice && <div className="cal-notice" role="status">{notice}{savedMeetingId && <button type="button" className="cal-refresh" onClick={()=>void openMeeting(savedMeetingId)}>View meeting status</button>}</div>}
    <div className="cal-range"><h2>{view === "upcoming" ? "Coming up" : `${meetingDate(range.from)} – ${meetingDate(new Date(+new Date(range.to) - 1).toISOString())}`}</h2><span>{data.meetings.length} meeting{data.meetings.length === 1 ? "" : "s"}{data.truncated ? " · first 200 shown" : ""}</span></div>
    {view === "upcoming" ? <div className="cal-upcoming">{data.meetings.length ? data.meetings.map((meeting) => <article key={meeting.id}><div className="cal-date-tile"><span>{new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", month: "short" }).format(new Date(meeting.starts_at))}</span><strong>{lagosDate(new Date(meeting.starts_at)).slice(-2)}</strong></div>{entry(meeting)}</article>) : <div className="cal-empty"><span aria-hidden="true">▦</span><h3>Room for what’s next.</h3><p>No upcoming meetings. Scheduled and imported workspace meetings will appear here.</p><button type="button" className="cal-primary" disabled={!canAdd} onClick={() => setDialog("create")}>Add Meeting</button></div>}</div> : <div className="cal-week">{days.map((day) => <section key={day} className="cal-day" data-today={day === today} aria-label={meetingDate(day + "T12:00:00+01:00")}><header><span>{new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short" }).format(new Date(day + "T12:00:00+01:00"))}</span><strong>{day.slice(-2)}</strong>{day === today && <small>Today</small>}</header><div>{data.meetings.filter((meeting) => new Date(meeting.starts_at) < new Date(lagosToISO(addDays(day,1) + "T00:00")) && new Date(meeting.ends_at) > new Date(lagosToISO(day + "T00:00"))).map(entry)}</div></section>)}</div>}
    <p className="cal-footer">{canSchedule ? "Every meeting is visible to active CEO and Admin accounts." : "You can view meetings where you are the organizer or an explicitly listed attendee."} Join links appear after Google Meet preparation succeeds. Recording requires an eligible host/co-host to join. Private in-app reminders: 1 hour, 10 minutes and at start, once reminder setup is applied. Department group delivery pending. Closed browsers are not guaranteed alerts.</p>
    {dialog !== null && <MeetingDialog key={typeof dialog === "string" ? "create" : dialog.id + ":" + dialog.version} meeting={typeof dialog === "string" ? null : dialog} userId={userId} canEnd={canEnd} canEdit={canEditMeetings} directory={directory} onClose={() => setDialog(null)} onReload={()=>{ setRefreshKey(value=>value+1); if (typeof dialog !== "string") void openMeeting(dialog.id); }} onSaved={(message,id) => { setDialog(null); setNotice(message); setSavedMeetingId(id ?? null); setRefreshKey((value) => value + 1); router.refresh(); }}/>}
  </section>;
}

