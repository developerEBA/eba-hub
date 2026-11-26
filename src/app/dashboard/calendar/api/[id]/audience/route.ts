import { calendarAuth,calendarAdmin,calendarHeaders,findMeeting } from "../../../server";
import { uuidPattern } from "../../../model";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Forbidden"},{status:403,headers:calendarHeaders});
 const auth=await calendarAuth();if(!auth)return Response.json({error:"Sign in again."},{status:401,headers:calendarHeaders});
 if(auth.role==="HOD")return Response.json({error:"HOD calendar access is read-only."},{status:403,headers:calendarHeaders});
 const {id}=await params;if(!uuidPattern.test(id))return Response.json({error:"Meeting unavailable."},{status:404,headers:calendarHeaders});
 const found=await findMeeting(auth.client,auth.user.id,id,auth.role);
 if(found.error)return Response.json({error:"Meeting unavailable."},{status:503,headers:calendarHeaders});
 if(!found.data||found.data.organizer_id!==auth.user.id)return Response.json({error:"Only its organizer can change visibility."},{status:404,headers:calendarHeaders});
 try{
   const raw=await request.text();if(raw.length>1000)throw Error();
   const body=JSON.parse(raw);
   if(!Number.isSafeInteger(body.version)||!["private","company","general","leadership"].includes(body.audience))throw Error();
   const db=calendarAdmin();if(!db)throw Error();
   const result=await db.rpc("calendar_set_audience",{p_actor:auth.user.id,p_id:id,p_version:body.version,p_audience:body.audience});
   if(result.error)return Response.json({error:"Visibility could not save. Refresh and check migration setup."},{status:409,headers:calendarHeaders});
   return Response.json({message:"Meeting visibility updated."},{headers:calendarHeaders});
 }catch{return Response.json({error:"Choose a valid visibility and refresh the meeting."},{status:400,headers:calendarHeaders})}
}
