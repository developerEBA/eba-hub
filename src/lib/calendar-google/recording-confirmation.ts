import "server-only";
import { calendarAdmin } from "../../app/dashboard/calendar/server";
import type { Meeting } from "../../app/dashboard/calendar/model";
import { validMeetUrl } from "../../app/dashboard/calendar/meet-model";
import { organizerAccess } from "../google-organizer/server";
import { CalendarGoogleProvider } from "./provider";
export async function confirmRecordingSetting(meeting:Meeting,actorId:string){
 const db=calendarAdmin(),email=process.env.GOOGLE_ORGANIZER_EMAIL;
 if(!db||!email||meeting.status!=="scheduled"||!validMeetUrl(meeting.join_url))throw Error("Confirmation unavailable");
 const row=await db.from("calendar_occurrences").select("provider_calendar_id,provider_event_id,join_url,version,status")
   .eq("id",meeting.id).eq("version",meeting.version).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
 if(row.error||!row.data||row.data.status!=="scheduled"||row.data.join_url!==meeting.join_url
   ||row.data.provider_calendar_id!==email||!row.data.provider_event_id)throw Error("Confirmation unavailable");
 const access=await organizerAccess();
 const provider=new CalendarGoogleProvider(async()=>access.accessToken,Date.now()+25_000);
 // Read only: do not enable recording, patch the event or start a recording.
 const event=await provider.getEvent(row.data.provider_event_id);
 const urls=[event?.hangoutLink,...(event?.conferenceData?.entryPoints??[]).filter(p=>p.entryPointType==="video").map(p=>p.uri)];
 if(!event||event.status==="cancelled"||event.organizer?.email!==email||!urls.includes(meeting.join_url))throw Error("Meeting changed in Google");
 const space=await provider.getSpace(meeting.join_url.split("/").at(-1)!);
 if(!space.name||(space.meetingUri!==meeting.join_url&&space.meetingCode!==meeting.join_url.split("/").at(-1)))throw Error("Space identity mismatch");
 const setting=space.config?.artifactConfig?.recordingConfig?.autoRecordingGeneration;
 if(setting!=="ON"&&setting!=="OFF")throw Error("Google did not return the recording setting");
 const automaticEnabled=setting==="ON";
 const saved=await db.rpc("calendar_confirm_recording",{p_actor:actorId,p_id:meeting.id,p_version:meeting.version,
   p_url:meeting.join_url,p_connection_version:access.version,p_email:email,p_enabled:automaticEnabled}).abortSignal(AbortSignal.timeout(8000));
 if(saved.error||saved.data!==true)throw Error("Confirmation could not be saved");
 return {automaticEnabled,message:automaticEnabled?"Automatic recording is confirmed ON in Google.":"Automatic recording is OFF in Google. A recording started manually is separate and is not tracked here."};
}
