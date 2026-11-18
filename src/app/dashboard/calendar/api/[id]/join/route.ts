import { calendarAuth, calendarHeaders, findMeeting } from "../../../server";
import { uuidPattern } from "../../../model";
import { validMeetUrl } from "../../../meet-model";
import { joinWindow } from "../../../join-window";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const headers={...calendarHeaders,"Referrer-Policy":"no-referrer"};
  const auth=await calendarAuth();
  if(!auth)return new Response("Sign in to view this meeting.",{status:401,headers});
  const {id}=await params;
  if(!uuidPattern.test(id))return new Response("Meeting unavailable.",{status:404,headers});
  const found=await findMeeting(auth.client,auth.user.id,id,auth.role);
  if(found.error)return new Response("Meeting status is unavailable. Try again.",{status:503,headers});
  if(!found.data||found.data.status!=="scheduled")return new Response("Meeting unavailable or cancelled.",{status:404,headers});
  const window=joinWindow(found.data);
  if(window.state!=="open")return new Response(window.state==="waiting"?"Joining opens at the scheduled start.":"Joining is closed for this occurrence.",{status:window.state==="waiting"?409:410,headers});
  if(!validMeetUrl(found.data.join_url))return new Response("The meeting link is not ready yet.",{status:409,headers});
  return new Response(null,{status:303,headers:{...headers,Location:found.data.join_url}});
}
