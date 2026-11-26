import {calendarAuth,calendarHeaders} from "../../server";
export async function GET(){
 if(!await calendarAuth())return Response.json({error:"Sign in required"},{status:401,headers:calendarHeaders});
 return Response.json({now:Date.now()},{headers:calendarHeaders});
}
