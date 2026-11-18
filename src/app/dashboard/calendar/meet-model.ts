import type { Meeting } from "./model";
import { joinWindow } from "./join-window";

export type LinkError = "reconnect_required" | "permission_required" | "provider_unavailable" | "conference_failed" | "conflict" | "attendees_invalid" | "organizer_changed" | "setup_required";
export const validMeetUrl = (value: unknown): value is string => typeof value === "string" && /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(value);
export const syncMessages: Record<LinkError,string> = {
  reconnect_required: "An Admin must reconnect Google in Settings, then retry.",
  permission_required: "Check Google permissions and Workspace policy. An Admin may need to reconnect, then retry.",
  provider_unavailable: "Google is unavailable or preparation is taking longer than expected. Retry safely.",
  conference_failed: "Google could not prepare the Meet conference. Retry to request it again.",
  conflict: "Google event identity or version conflicts with this meeting. Review it before retrying; create a new meeting if Google deleted the original.",
  attendees_invalid: "Some participants no longer have an active staff account with a verified email. Review the attendees before retrying.",
  organizer_changed: "This event belongs to a different Google organizer. Ask an Admin to restore the original organizer before retrying.",
  setup_required: "Google meeting setup is incomplete. Ask an Admin to check Settings and the worker configuration.",
};
export function meetPresentation(meeting: Meeting,now=Date.now()) {
  const window=joinWindow(meeting,now);
  const link=meeting.status === "scheduled"&&validMeetUrl(meeting.join_url)?meeting.join_url:null;
  const url=window.state==="open"?link:null;
  const error = meeting.link_error_code;
  const label = meeting.status === "cancelled" ? meeting.sync_status === "synced" ? "Cancelled" : "Cancellation pending"
    : window.state==="closed"?"Joining closed"
    : window.state==="expired"?"Joining window ended"
    : error === "reconnect_required" ? "Reconnect required"
    : error ? "Meeting needs attention"
    : link&&window.state==="waiting"?"Opens at scheduled start"
    : url ? meeting.sync_status === "synced" ? "Ready" : "Updating meeting"
    : meeting.source === "google" ? "No Meet link in Google" : meeting.sync_status ? "Preparing meeting" : "Meet setup pending";
  return { url, label, warning: error ? syncMessages[error] : null,window,link };
}
