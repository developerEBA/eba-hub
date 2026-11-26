import { calendarAuth,calendarHeaders,findMeeting } from "../../../server";
import { uuidPattern } from "../../../model";
import { validMeetUrl } from "../../../meet-model";
import { confirmRecordingSetting } from "../../../../../../lib/calendar-google/recording-confirmation";
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Forbidden"},{status:403,headers:calendarHeaders});
 const auth=await calendarAuth();if(!auth)return Response.json({error:"Sign in again."},{status:401,headers:calendarHeaders});
 if(auth.role==="HOD")return Response.json({error:"Recording controls are unavailable in HOD calendar access."},{status:403,headers:calendarHeaders});
 const {id}=await params;if(!uuidPattern.test(id))return Response.json({error:"Meeting unavailable."},{status:404,headers:calendarHeaders});
 const found=await findMeeting(auth.client,auth.user.id,id,auth.role);
 if(found.error)return Response.json({error:"Meeting status unavailable."},{status:503,headers:calendarHeaders});
 if(!found.data)return Response.json({error:"Meeting unavailable."},{status:404,headers:calendarHeaders});
 if(found.data.status!=="scheduled"||!validMeetUrl(found.data.join_url))return Response.json({error:"A current Google Meet link is required."},{status:409,headers:calendarHeaders});
 try{return Response.json(await confirmRecordingSetting(found.data,auth.user.id),{headers:calendarHeaders})}
 catch{return Response.json({error:"Could not confirm the current Google setting. Check Google authorization, refresh the meeting, and confirm the recording-confirmation migration is applied."},{status:503,headers:calendarHeaders})}
}
