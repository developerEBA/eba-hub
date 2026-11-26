"use client";

import { useEffect, useRef, useState } from "react";
import { calendarRequestId, localDateTime, meetingDate, meetingTime, type Directory, type Meeting } from "./model";
import { MeetStatus } from "./meet-status";
import { MeetingVisibility } from "./meeting-visibility";
import { MeetingEndControls } from "./meeting-end-controls";

export function MeetingDialog({ meeting, userId, directory, onClose, onSaved, onReload,canEnd=false,canEdit=true }: { meeting: Meeting | null; userId: string; directory: Directory; onClose: () => void; onSaved: (message: string,id?: string) => void; onReload?: () => void;canEnd?:boolean;canEdit?:boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), requestId = useRef<string | null>(null);
  const [editing, setEditing] = useState(!meeting), [cancelling, setCancelling] = useState(false);
  const [scope, setScope] = useState("one"), [frequency, setFrequency] = useState(meeting?.frequency ?? "once");
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const organizer = !meeting || meeting.organizer_id === userId;
  const requiredParticipants = directory.requiredParticipants ?? [];
  const allPeople = [...directory.people, ...requiredParticipants.filter((required) => !directory.people.some((person) => person.user_id === required.user_id))];
  const requiredIds = new Set(requiredParticipants.map((person) => person.user_id));
  const canChange = canEdit && meeting?.source !== "google" && organizer && (!meeting || (meeting.status === "scheduled" && new Date(meeting.ends_at) > new Date()));
  const [defaults] = useState(() => {
    const start = meeting?.starts_at ?? new Date(Math.ceil((Date.now() + 60000) / 1800000) * 1800000).toISOString();
    return { start, end: meeting?.ends_at ?? new Date(+new Date(start) + 3600000).toISOString() };
  });
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function submit(form: FormData | null) {
    if (pending) return;
    setPending(true); setError("");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      requestId.current ??= calendarRequestId();
      const body = { command: cancelling ? "cancel" : meeting ? "update" : "create", requestId: requestId.current,
        id: meeting?.id, version: meeting?.version, scope,
        ...(form ? { title: form.get("title"), agenda: form.get("agenda"), start: form.get("start"), end: form.get("end"),
          frequency, until: form.get("until"), attendees: form.getAll("attendees"), departments: form.getAll("departments") } : {}),
      };
      const response = await fetch("/dashboard/calendar/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "This meeting could not be saved.");
      onSaved(value.message ?? "Meeting saved.",value.id);
    } catch (failure) { setError(controller.signal.aborted ? "The request timed out. Retry safely, or close and refresh to check whether it saved." : failure instanceof Error ? failure.message : "Check your connection and try again."); }
    finally { clearTimeout(timer); setPending(false); }
  }
  return <dialog ref={dialog} className="cal-dialog" aria-labelledby="meeting-dialog-title" onCancel={(event) => { if (pending) event.preventDefault(); else onClose(); }}>
    <header className="cal-dialog__header"><div><p>{meeting ? organizer ? "Your meeting" : meeting.attendee_ids.includes(userId) ? "You’re invited" : "Workspace meeting" : "Bring the right people together"}</p><h2 id="meeting-dialog-title">{cancelling ? "Cancel meeting" : editing ? meeting ? "Edit meeting" : "Add meeting" : meeting?.title}</h2></div><button type="button" disabled={pending} onClick={onClose} aria-label="Close meeting">×</button></header>
    {error && <p className="cal-alert" role="alert">{error}</p>}
    {(editing || cancelling) && meeting?.frequency === "weekly" && <label className="cal-field cal-scope">Apply this change to<select aria-label="Apply this change to" value={scope} disabled={pending} onChange={(event) => { setScope(event.target.value); requestId.current = null; }}><option value="one">This occurrence only</option><option value="remaining">This and remaining occurrences</option></select></label>}
    {cancelling ? <div className="cal-cancel"><p>Cancel <strong>{meeting?.title}</strong>{scope === "remaining" ? " and its remaining future occurrences" : " on " + meetingDate(meeting!.starts_at)}?</p><p>Cancelled dates disappear from upcoming meetings. Their occurrence IDs remain available for reminder and provider synchronization.</p><footer><button type="button" disabled={pending} onClick={() => { setCancelling(false); setError(""); requestId.current = null; }}>Keep meeting</button><button type="button" className="cal-danger" disabled={pending} onClick={() => void submit(null)}>{pending ? "Cancelling…" : "Confirm cancellation"}</button></footer></div> : editing ? <form className="cal-form" onChange={() => { requestId.current = null; }} onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
      <label className="cal-field">Title<input name="title" required maxLength={160} defaultValue={meeting?.title ?? ""} autoFocus disabled={pending}/></label>
      <label className="cal-field">Agenda <span>Optional</span><textarea name="agenda" rows={3} maxLength={4000} defaultValue={meeting?.agenda ?? ""} disabled={pending}/></label>
      <div className="cal-form__pair"><label className="cal-field">Starts · Africa/Lagos<input name="start" type="datetime-local" required defaultValue={localDateTime(defaults.start)} disabled={pending}/></label><label className="cal-field">Ends · Africa/Lagos<input name="end" type="datetime-local" required defaultValue={localDateTime(defaults.end)} disabled={pending}/></label></div>
      {!meeting && <label className="cal-field">Repeats<select aria-label="Repeats" value={frequency} disabled={pending} onChange={(event) => setFrequency(event.target.value as "once" | "weekly")}><option value="once">One-off meeting</option><option value="weekly">Every week</option></select></label>}
      {frequency === "weekly" && (!meeting || scope === "remaining") && <label className="cal-field">Last meeting date<input name="until" type="date" aria-label="Last meeting date" aria-describedby="recurrence-help" required defaultValue={meeting?.recurrence_until ?? ""} disabled={pending}/><small id="recurrence-help">Weekly at the selected Lagos time, including this date when it falls on the meeting’s weekday. Maximum 52 weeks.</small></label>}
      <fieldset className="cal-attendees" disabled={pending}><legend>Meeting participants</legend><p>Required participants are added automatically and cannot be removed: eligible active CEO, Admin and Communications HOD accounts. You’re included as organizer.</p><div className="cal-required-participants"><strong>Required participants</strong>{requiredParticipants.length ? <ul>{requiredParticipants.map((person) => <li key={person.user_id}>{person.display_name} <small>{person.role === "ceo" ? "CEO" : person.role === "admin" ? "Admin" : "Communications HOD"}</small></li>)}</ul> : <p>{directory.ready ? "No active, verified CEO, Admin or Communications HOD memberships are currently eligible." : "Required membership could not be loaded. Refresh the directory before scheduling."}</p>}</div><div><strong>Additional invitations</strong>{directory.people.filter((person) => person.user_id !== userId && !requiredIds.has(person.user_id)).map((person) => <label key={person.user_id}><input type="checkbox" name="attendees" value={person.user_id} defaultChecked={meeting?.attendee_ids.includes(person.user_id)}/><span>{person.display_name}<small>{person.role === "ceo" ? "CEO" : person.role === "admin" ? "Admin" : "HOD"}</small></span></label>)}</div>{directory.people.filter((person) => person.user_id !== userId && !requiredIds.has(person.user_id)).length === 0 && <p>No additional eligible attendees are available.</p>}</fieldset>
      <details className="cal-departments"><summary>Invite by department</summary>{directory.departments.length ? <fieldset disabled={pending}><legend className="cal-visually-hidden">Assigned departments</legend>{directory.departments.map((department) => <label key={department.id}><input type="checkbox" name="departments" value={department.id} defaultChecked={meeting?.department_targets.includes(department.id)}/>{department.label}<small>{department.count} active</small></label>)}<p>Members are selected from current assignments when you save. Later assignment changes won’t silently change existing invitations.</p></fieldset> : <p>Department targeting is prepared. Options will appear when real active staff assignments are added.</p>}</details>
      <p className="cal-meet-status">{meeting ? "Google Calendar will update after you save." : "Meet setup pending. Your online meeting is saved first, then prepared with Google Meet."}</p>
      <footer className="cal-form__footer"><button type="button" disabled={pending} onClick={onClose}>Close</button><button type="submit" className="cal-primary" disabled={pending || !directory.ready}>{pending ? "Saving…" : meeting ? "Save changes" : "Schedule meeting"}</button></footer>
    </form> : meeting && <div className="cal-details">
      <dl><div><dt>When</dt><dd>{meetingDate(meeting.starts_at)} · {meetingTime(meeting.starts_at)}–{meetingTime(meeting.ends_at)}<small>{meetingDate(meeting.ends_at) !== meetingDate(meeting.starts_at) ? `Ends ${meetingDate(meeting.ends_at)} · ` : ""}Africa/Lagos</small></dd></div><div><dt>{meeting.source === "google" ? "EBA coordinator" : "Organizer"}</dt><dd>{meeting.organizer_id === userId ? "You" : allPeople.find((person) => person.user_id === meeting.organizer_id)?.display_name ?? "Meeting organizer"}</dd></div><div><dt>Attendees</dt><dd>{meeting.attendee_ids.map((id) => id === userId ? "You" : allPeople.find((person) => person.user_id === id)?.display_name ?? "Former or inactive attendee").join(", ")}</dd></div><div><dt>Repeats</dt><dd>{meeting.frequency === "weekly" ? `Weekly · through ${meeting.recurrence_until}` : "One-off meeting"}</dd></div></dl>
      {meeting.agenda && <section><h3>Agenda</h3><p className="cal-details__agenda">{meeting.agenda}</p></section>}
      <MeetStatus meeting={meeting} organizer={organizer && meeting.source !== "google"} onChanged={onReload}/>
      {canEnd&&<MeetingEndControls meeting={meeting} onChanged={onReload}/>}
      <MeetingVisibility key={`${meeting.id}:${meeting.audience_version??1}`} meeting={meeting} canChange={organizer} onChanged={onReload}/>
      {meeting.status === "cancelled" && <p className="cal-alert">This occurrence is cancelled.</p>}
      {canChange ? <footer><button type="button" className="cal-danger-link" onClick={() => setCancelling(true)}>Cancel meeting</button><button type="button" className="cal-primary" onClick={() => setEditing(true)}>Edit meeting</button></footer> : <p className="cal-readonly">{meeting.source === "google" ? "Imported from Google Calendar. Edit or cancel it in Google; changes will sync automatically." : organizer ? "Past and cancelled occurrences are read-only." : "Only the organizer can edit or cancel this meeting."}</p>}
    </div>}
  </dialog>;
}
