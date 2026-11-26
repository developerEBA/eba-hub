import "server-only";
import { calendarAdmin } from "../../app/dashboard/calendar/server";

export async function endPermission(id:string,userId:string){
 const db=calendarAdmin(),email=process.env.GOOGLE_ORGANIZER_EMAIL;
 if(!db||!email)return "setup_required" as const;
 const row=await db.from("calendar_occurrences").select("organizer_id,provider_calendar_id,provider_event_id")
  .eq("id",id).abortSignal(AbortSignal.timeout(3000)).maybeSingle();
 if(row.error||!row.data)return "setup_required" as const;
 if(row.data.organizer_id!==userId)return "not_manager" as const;
 if(row.data.provider_calendar_id!==email)return "foreign_owner" as const;
 if(!row.data.provider_event_id)return "setup_required" as const;
 return "eligible" as const;
}
