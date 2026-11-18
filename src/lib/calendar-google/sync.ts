import "server-only";
import { createHash } from "node:crypto";
import type { Meeting } from "../../app/dashboard/calendar/model";
import { validMeetUrl, type LinkError } from "../../app/dashboard/calendar/meet-model";
import { GoogleHttpError, type GoogleEvent, type GoogleMeetProvider } from "./provider";

export type SyncMeeting = Meeting & { provider_calendar_id: string | null; provider_event_id: string | null; provider_conference_id: string | null; meet_space_name: string | null };
export type SyncJob = { occurrence_id: string; desired_version: number; lease_token: string; attempts: number; conference_generation: number; create_attempted: boolean; cancel_settle_until: string | null };
export type Claim = { meeting: SyncMeeting; job: SyncJob };
export type SyncResult = { state: "done" | "retry" | "blocked" | "failed"; sync_status: string; recording_status?: string;
  join_url?: string | null; conference_id?: string; etag?: string; space_name?: string; link_error_code?: LinkError | null; error_code?: string; delay?: number };
export interface SyncRepository {
  claim(id?: string): Promise<Claim | null>;
  current(claim: Claim): Promise<boolean>;
  bind(claim: Claim, email: string, eventId: string, createAttempt: boolean): Promise<boolean>;
  people(ids: string[]): Promise<{ user_id: string; email: string }[]>;
  finish(claim: Claim, result: SyncResult): Promise<boolean>;
}
export class SyncFailure extends Error { constructor(public code: LinkError) { super(code); } }
class Superseded extends Error {}
export const eventIdFor = (id: string) => "eba" + id.replaceAll("-", "").toLowerCase();
export const conferenceRequestFor = (id: string, generation: number) => `${eventIdFor(id)}c${generation}`;
const normalizeEmails = (people: { email: string }[] = []) => people.map(p=>p.email.toLowerCase()).sort().join("|");
export function desiredEvent(meeting: SyncMeeting, emails: string[], workspace: string) {
  const body = { summary: meeting.title, description: meeting.agenda ?? "",
    start: { dateTime: meeting.starts_at, timeZone: "Africa/Lagos" }, end: { dateTime: meeting.ends_at, timeZone: "Africa/Lagos" },
    attendees: [...new Set(emails)].sort().map(email=>({ email })),
    guestsCanModify: false, guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false,
    reminders: { useDefault: false, overrides: [] },
  };
  return { ...body, extendedProperties: { private: { ebaOccurrence: meeting.id, ebaSeries: meeting.series_id,
    ebaWorkspace: workspace, ebaVersion: String(meeting.version),
    ebaPayload: createHash("sha256").update(JSON.stringify(body)).digest("hex") } } };
}
function ownsEvent(event: GoogleEvent, meeting: SyncMeeting, workspace: string) {
  const marker = event.extendedProperties?.private;
  return marker?.ebaOccurrence === meeting.id && marker.ebaSeries === meeting.series_id && marker.ebaWorkspace === workspace;
}
function matches(event: GoogleEvent, body: ReturnType<typeof desiredEvent>) {
  return event.extendedProperties?.private?.ebaPayload === body.extendedProperties.private.ebaPayload
    && event.extendedProperties.private.ebaVersion === body.extendedProperties.private.ebaVersion
    && event.summary === body.summary && (event.description ?? "") === body.description
    && +new Date(event.start?.dateTime ?? "") === +new Date(body.start.dateTime)
    && +new Date(event.end?.dateTime ?? "") === +new Date(body.end.dateTime)
    && normalizeEmails(event.attendees) === normalizeEmails(body.attendees)
    && event.guestsCanModify !== true && event.guestsCanInviteOthers === false && event.guestsCanSeeOtherGuests === false;
}
export function conferenceLink(event: GoogleEvent) {
  const conference = event.conferenceData;
  if (conference?.createRequest?.status?.statusCode === "pending" || conference?.createRequest?.status?.statusCode === "failure"
    || conference?.conferenceSolution?.key?.type !== "hangoutsMeet") return null;
  const url = conference.entryPoints?.find(p=>p.entryPointType === "video" && validMeetUrl(p.uri))?.uri;
  return validMeetUrl(url) && conference.conferenceId === url.split("/").at(-1) ? { url, id: conference.conferenceId! } : null;
}
export function failureCode(error: unknown): LinkError {
  if (error instanceof SyncFailure) return error.code;
  if (error instanceof GoogleHttpError) return error.status === 401 ? "reconnect_required" : error.status === 403 ? "permission_required"
    : [409,410,412].includes(error.status) ? "conflict" : "provider_unavailable";
  return "provider_unavailable";
}

// All I/O is awaited. Google writes are guarded by the durable lease/version and
// If-Match. Finishing rechecks the same version under database locks.
export async function synchronizeClaim(repo: SyncRepository, provider: GoogleMeetProvider, claim: Claim, organizerEmail: string, workspace: string) {
  const m = claim.meeting, job = claim.job, id = m.provider_event_id ?? eventIdFor(m.id);
  let progress: Partial<SyncResult> = {}, linkReady = false;
  const current = async () => { if (!await repo.current(claim)) throw new Superseded(); };
  const finish = (result: SyncResult) => repo.finish(claim, result);
  try {
    await current();
    if (m.provider_calendar_id && m.provider_calendar_id !== organizerEmail) throw new SyncFailure("organizer_changed");
    if (!await repo.bind(claim,organizerEmail,id,false)) throw new Superseded();
    let event = await provider.getEvent(id);
    await current();
    if (event && event.id !== id) throw new SyncFailure("conflict");
    if (m.status === "cancelled") {
      if (event && event.status !== "cancelled") {
        if (!ownsEvent(event,m,workspace) || !event.etag) throw new SyncFailure("conflict");
        await current(); await provider.deleteEvent(id,event.etag);
      }
      // If an earlier insert timed out, a 404 is not definitive proof Google did
      // not accept it. Reconcile for a day to catch a late-arriving create.
      const settling = !event && job.create_attempted && job.cancel_settle_until && +new Date(job.cancel_settle_until)>Date.now();
      return await finish({ state: settling ? "retry" : "done", sync_status: settling ? "pending_cancel" : "synced", join_url: null,
        recording_status: "pending", delay: 60 });
    }
    if (event?.status === "cancelled" || new Date(m.ends_at)<=new Date()) throw new SyncFailure("conflict");
    const ids = [...new Set([m.organizer_id,...m.attendee_ids])], people = await repo.people(ids);
    if (people.length !== ids.length || ids.some(id=>!people.some(p=>p.user_id === id)) || people.some(p=>!p.email || !/^[^@\s]+@enibrand\.com$/i.test(p.email))) throw new SyncFailure("attendees_invalid");
    const body = desiredEvent(m,people.map(p=>p.email).filter(email=>email.toLowerCase()!==organizerEmail.toLowerCase()),workspace);
    const requestId = conferenceRequestFor(m.id,job.conference_generation);
    const conferenceData = { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } };
    if (!event) {
      if (!await repo.bind(claim,organizerEmail,id,true)) throw new Superseded();
      await current();
      try { event = await provider.insertEvent({ id,...body,conferenceData }); }
      catch (error) {
        if (!(error instanceof GoogleHttpError) || error.status !== 409) throw error;
        event = await provider.getEvent(id);
        if (!event) throw new SyncFailure("provider_unavailable");
      }
    }
    await current();
    const remoteVersion = Number(event?.extendedProperties?.private?.ebaVersion);
    if (!event || event.id !== id || event.status === "cancelled" || !ownsEvent(event,m,workspace)
      || !Number.isSafeInteger(remoteVersion) || remoteVersion<1 || remoteVersion>m.version) throw new SyncFailure("conflict");
    const state = event.conferenceData?.createRequest?.status?.statusCode;
    const failedRequest = state === "failure";
    const newConference = !conferenceLink(event) && state !== "pending" && (!failedRequest || event.conferenceData?.createRequest?.requestId !== requestId);
    if (!matches(event,body) || newConference) {
      if (!event.etag) throw new SyncFailure("conflict");
      await current();
      event = await provider.patchEvent(id,event.etag,{ ...body,...(newConference ? { conferenceData } : {}) });
    }
    await current();
    if (event.id !== id || event.status === "cancelled" || !ownsEvent(event,m,workspace)
      || Number(event.extendedProperties?.private?.ebaVersion)!==m.version) throw new SyncFailure("conflict");
    progress = { etag: event.etag };
    const link = conferenceLink(event);
    if (!link) {
      progress.join_url = null;
      if (event.conferenceData?.createRequest?.status?.statusCode === "failure") throw new SyncFailure("conference_failed");
      if (job.attempts >= 12) throw new SyncFailure("provider_unavailable");
      return await finish({ ...progress,state: "retry",sync_status: "pending_create",recording_status: "pending",delay: Math.min(300,15*2**Math.min(job.attempts,4)) });
    }
    linkReady = true; progress = { ...progress,join_url: link.url,conference_id: link.id };
    await current();
    const knownSpace = m.provider_conference_id === link.id ? m.meet_space_name : null;
    let space = await provider.getSpace(knownSpace ?? link.id);
    if (!space.name || !/^spaces\/[A-Za-z0-9_-]+$/.test(space.name) || space.meetingCode !== link.id || space.meetingUri !== link.url) throw new SyncFailure("provider_unavailable");
    if (knownSpace && space.name !== knownSpace) throw new SyncFailure("conflict");
    progress.space_name = space.name;
    if (space.config?.artifactConfig?.recordingConfig?.autoRecordingGeneration !== "ON") {
      await current();
      const name = space.name!;
      space = await provider.configureRecording(name);
      if (space.name !== name || space.config?.artifactConfig?.recordingConfig?.autoRecordingGeneration !== "ON") throw new SyncFailure("provider_unavailable");
    }
    await current();
    return await finish({ ...progress,state: "done",sync_status: "synced",recording_status: "configured" });
  } catch (error) {
    if (error instanceof Superseded) return false;
    const code = failureCode(error), blocked = ["reconnect_required","permission_required","setup_required","organizer_changed","attendees_invalid"].includes(code);
    // 412 means another writer won. Re-read on the next attempt instead of
    // retrying the same stale write. No event or conference ID is regenerated.
    const retry = (code === "provider_unavailable" || (error instanceof GoogleHttpError && [409,412].includes(error.status))) && job.attempts<8;
    return await finish({ ...progress,state: blocked ? "blocked" : retry ? "retry" : "failed",sync_status: linkReady ? "synced" : "error",
      recording_status: linkReady ? code === "reconnect_required" ? "reconnect_required" : "warning" : m.recording_status ?? "pending",
      link_error_code: linkReady && code !== "reconnect_required" ? null : code,error_code: code,delay: Math.min(3600,15*2**Math.min(job.attempts,8)) });
  }
}
