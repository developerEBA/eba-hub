import { calendarAuth,calendarAdmin,calendarHeaders,findMeeting } from "../../../server";
import { uuidPattern } from "../../../model";
import { joinWindow } from "../../../join-window";
import { runCallEnding } from "../../../../../../lib/calendar-google/call-ending";
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Forbidden"},{status:403,headers:calendarHeaders});
 const auth=await calendarAuth();if(!auth)return Response.json({error:"Sign in again."},{status:401,headers:calendarHeaders});
 if(auth.role!=="Admin")return Response.json({error:"Only an active Admin can end a meeting."},{status:403,headers:calendarHeaders});
 const {id}=await params;if(!uuidPattern.test(id))return Response.json({error:"Meeting unavailable."},{status:404,headers:calendarHeaders});
 const found=await findMeeting(auth.client,auth.user.id,id,auth.role);
 if(found.error)return Response.json({error:"Meeting unavailable."},{status:503,headers:calendarHeaders});
 if(!found.data||found.data.status!=="scheduled")return Response.json({error:"Meeting unavailable."},{status:404,headers:calendarHeaders});
 if(joinWindow(found.data).state==="waiting")return Response.json({error:"This occurrence has not opened for joining."},{status:409,headers:calendarHeaders});
 const db=calendarAdmin();if(!db)return Response.json({error:"Meeting controls unavailable."},{status:503,headers:calendarHeaders});
 const requested=await db.rpc("calendar_call_end_control",{p_action:"request",p_id:id,p_actor:auth.user.id});
 if(requested.error)return Response.json({error:"Ending could not be requested. Check migration setup and retry."},{status:503,headers:calendarHeaders});
 await runCallEnding(id);
 const latest=await findMeeting(auth.client,auth.user.id,id,auth.role);
 const state=latest.data?.call_end_status??"pending";
 const message=state==="ended"?"EBA joining is closed. Google reports that the observed call has ended."
  :state==="no_active_call"?"EBA joining is closed. Google reported no active call."
  :state==="unavailable"?"EBA joining is closed, but Google call termination is unavailable. Use the eligible Google host's End meeting for all control."
  :state==="shared_space"?"EBA joining is closed. Another occurrence is using this Meet link, so Google termination was blocked."
  :"EBA joining is closed. Google call termination is pending and has not been confirmed.";
 return Response.json({state,message},{status:["ended","no_active_call"].includes(state)?200:202,headers:calendarHeaders});
}
