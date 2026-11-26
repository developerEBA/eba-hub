import "server-only";

export type GoogleEvent = {
  organizer?: { email?: string }; attendeesOmitted?: boolean;
  id: string; etag?: string; status?: string; summary?: string; description?: string;
  start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string };
  attendees?: { email: string; responseStatus?: string }[]; guestsCanModify?: boolean; guestsCanInviteOthers?: boolean; guestsCanSeeOtherGuests?: boolean;
  extendedProperties?: { private?: Record<string,string> }; hangoutLink?: string;
  conferenceData?: { conferenceId?: string; conferenceSolution?: { key?: { type?: string } };
    createRequest?: { requestId?: string; status?: { statusCode?: string } }; entryPoints?: { entryPointType?: string; uri?: string }[] };
};
export type GoogleSpace = { name?: string; meetingCode?: string; meetingUri?: string;
  activeConference?:{conferenceRecord?:string};
  config?: { artifactConfig?: { recordingConfig?: { autoRecordingGeneration?: string } } } };
export class GoogleHttpError extends Error { constructor(public status: number) { super("Google request failed"); } }
export interface GoogleMeetProvider {
  getEvent(id: string): Promise<GoogleEvent | null>;
  insertEvent(body: Record<string,unknown>): Promise<GoogleEvent>;
  patchEvent(id: string, etag: string, body: Record<string,unknown>): Promise<GoogleEvent>;
  deleteEvent(id: string, etag: string): Promise<void>;
  getSpace(identifier: string): Promise<GoogleSpace>;
  configureRecording(name: string): Promise<GoogleSpace>;
}


export class CalendarGoogleProvider implements GoogleMeetProvider {
  constructor(private access: () => Promise<string>, private deadline = Infinity) {}
  listEvents(from:string,to:string,page?:string) {
    const query=new URLSearchParams({timeMin:from,timeMax:to,singleEvents:"true",showDeleted:"true",maxResults:"100"});
    if(page)query.set("pageToken",page);
    return this.call<{items?:GoogleEvent[];nextPageToken?:string}>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`);
  }
  private async call<T>(url: string, method = "GET", body?: Record<string,unknown>, etag?: string): Promise<T> {
    if (Date.now()>=this.deadline) throw new GoogleHttpError(503);
    const token = await this.access();
    const remaining = this.deadline-Date.now();
    if (remaining<=0) throw new GoogleHttpError(503);
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(etag ? { "If-Match": etag } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(Math.min(12_000,remaining)) });
    if (!response.ok) throw new GoogleHttpError(response.status);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  async getEvent(id: string) {
    try { return await this.call<GoogleEvent>(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`); }
    catch (error) { if (error instanceof GoogleHttpError && error.status === 404) return null;
      if (error instanceof GoogleHttpError && error.status === 410) return { id, status: "cancelled" }; throw error; }
  }
  insertEvent(body: Record<string,unknown>) { return this.call<GoogleEvent>("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", "POST", body); }
  patchEvent(id: string, etag: string, body: Record<string,unknown>) { return this.call<GoogleEvent>(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}?conferenceDataVersion=1&sendUpdates=all`, "PATCH", body, etag); }
  async deleteEvent(id: string, etag: string) {
    try { await this.call<void>(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`, "DELETE", undefined, etag); }
    catch (error) { if (!(error instanceof GoogleHttpError) || ![404,410].includes(error.status)) throw error; }
  }
  getSpace(identifier: string) {
    if (!/^(?:spaces\/)?[A-Za-z0-9_-]+$/.test(identifier)) throw new Error("Invalid space identity");
    return this.call<GoogleSpace>(`https://meet.googleapis.com/v2/spaces/${encodeURIComponent(identifier.replace(/^spaces\//,""))}`);
  }
  configureRecording(name: string) {
    if (!/^spaces\/[A-Za-z0-9_-]+$/.test(name)) throw new Error("Invalid space identity");
    return this.call<GoogleSpace>(`https://meet.googleapis.com/v2/${name}?updateMask=config.artifactConfig.recordingConfig.autoRecordingGeneration`, "PATCH", {
      name, config: { artifactConfig: { recordingConfig: { autoRecordingGeneration: "ON" } } },
    });
  }
  getConferenceRecord(name:string){
    if(!/^conferenceRecords\/[A-Za-z0-9_-]+$/.test(name))throw Error("Invalid conference identity");
    return this.call<{name?:string;startTime?:string;endTime?:string}>(`https://meet.googleapis.com/v2/${name}`);
  }
  endActiveConference(name:string){
    if(!/^spaces\/[A-Za-z0-9_-]+$/.test(name))throw Error("Invalid space identity");
    return this.call<Record<string,never>>(`https://meet.googleapis.com/v2/${name}:endActiveConference`,"POST");
  }
}
