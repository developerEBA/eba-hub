import {manageStaff,staffActor,staffHeaders,staffRPC,trustedOrigin} from "../../../../lib/staff-access/server";
export async function GET(){
 const actor=await staffActor();if(!actor)return Response.json({error:"Active CEO/Admin access required."},{status:403,headers:staffHeaders});
 try{return Response.json(await staffRPC("directory",actor.id),{headers:staffHeaders})}
 catch{return Response.json({error:"Staff directory could not load. Please try again."},{status:503,headers:staffHeaders})}
}
export async function POST(request:Request){
 if(!trustedOrigin(request))return Response.json({error:"Request origin denied or application URL not configured."},{status:403,headers:staffHeaders});
 const actor=await staffActor();if(!actor||actor.role!=="Admin")return Response.json({error:"Only an active Admin can manage staff access."},{status:403,headers:staffHeaders});
 try{
  const raw=await request.text();if(raw.length>5000)return Response.json({error:"Request too large."},{status:413,headers:staffHeaders});
  const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw Error("Invalid request.");
  return Response.json(await manageStaff(body.action,actor.id,body),{headers:staffHeaders});
 }catch(error){return Response.json({error:error instanceof SyntaxError?"Invalid request.":error instanceof Error?error.message:"Staff change unavailable."},{status:409,headers:staffHeaders})}
}
