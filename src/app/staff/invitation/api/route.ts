import {createSessionClient,clearStaffSession} from "../../../../lib/staff-auth";
import {hashInvite,staffHeaders,staffRPC,trustedOrigin} from "../../../../lib/staff-access/server";
const inviteCookie="eba-staff-invitation";
export async function POST(request:Request){
 if(!trustedOrigin(request))return Response.json({error:"Request origin denied."},{status:403,headers:staffHeaders});
 const client=await createSessionClient(inviteCookie);if(!client)return Response.json({error:"Acceptance unavailable."},{status:503,headers:staffHeaders});
 try{
  const raw=await request.text();if(raw.length>5000)throw Error("Invalid invitation");
  const data=JSON.parse(raw);
  if(!data||! /^[a-f0-9]{64}$/.test(data.invite??"")||typeof data.token_hash!=="string"||data.token_hash.length>2048||!["invite","magiclink"].includes(data.type))throw Error("Invalid invitation");
  const hash=hashInvite(data.invite),info=await staffRPC("inspect",null,{token_hash:hash});
  if(info.new_account&&(typeof data.password!=="string"||data.password.length<12||data.password.length>128))return Response.json({error:"Choose a password of 12–128 characters."},{status:400,headers:staffHeaders});
  const verified=await client.auth.verifyOtp({token_hash:data.token_hash,type:data.type});
  if(verified.error||!verified.data.user?.email_confirmed_at)throw Error("Ownership verification failed");
  // Verify account binding BEFORE allowing a password change. Client input never chooses the identity.
  const {data:identity,error}=await client.auth.getUser();
  if(error||!identity.user||identity.user.id!==verified.data.user.id)throw Error("Identity unavailable");
  await staffRPC("verify_identity",identity.user.id,{token_hash:hash});
  if(info.new_account){const changed=await client.auth.updateUser({password:data.password});if(changed.error)throw Error("Password could not be set")}
  const result=await staffRPC("accept",identity.user.id,{token_hash:hash});
  return Response.json({ok:result.ok,message:"Invitation accepted. Sign in to manage your profile. Dashboard access follows the active role and department assignment."},{headers:staffHeaders});
 }catch{return Response.json({error:"Invitation cannot be accepted. It may be expired, revoked, already used, or linked to a different verified identity. Ask an Admin for a new invitation."},{status:409,headers:staffHeaders})}
 finally{await clearStaffSession(client,inviteCookie)}
}
