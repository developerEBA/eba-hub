import { calendarAdmin,calendarAuth,calendarHeaders } from "../../server";

function logReconciliationRpcError(mode:"preview"|"apply",code:string|undefined) {


  const safeCode=code&&(/^[0-9A-Z]{5}$/.test(code)||/^PGRST[0-9]{3}$/.test(code))?code:"UNKNOWN";
  console.error("[calendar.required-participants.reconciliation]",{mode,code:safeCode});
}

export async function GET() {
  const auth=await calendarAuth();
  if(!auth||!(auth.role==="CEO"||auth.role==="Admin"))return Response.json({error:"Active CEO or Admin access required."},{status:401,headers:calendarHeaders});
  const admin=calendarAdmin();
  if(!admin)return Response.json({error:"Calendar server configuration is pending."},{status:503,headers:calendarHeaders});
  const result=await admin.rpc("calendar_reconcile_required_participants",{p_actor:auth.user.id,p_apply:false});
  if(result.error){
    logReconciliationRpcError("preview",result.error.code);
    return Response.json({error:"Reconciliation preview is unavailable. Confirm the required-participants migration, then retry."},{status:503,headers:calendarHeaders});
  }
  return Response.json({preview:result.data},{headers:calendarHeaders});
}

export async function POST(request:Request) {
  if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Request origin rejected."},{status:403,headers:calendarHeaders});
  const auth=await calendarAuth();
  if(!auth||auth.role!=="Admin")return Response.json({error:"An active Admin account is required to apply reconciliation."},{status:403,headers:calendarHeaders});
  const admin=calendarAdmin();
  if(!admin)return Response.json({error:"Calendar server configuration is pending."},{status:503,headers:calendarHeaders});
  const result=await admin.rpc("calendar_reconcile_required_participants",{p_actor:auth.user.id,p_apply:true});
  if(result.error){
    logReconciliationRpcError("apply",result.error.code);
    const message=/100-attendee limit/i.test(result.error.message)
      ? "Reconciliation exceeds the 100-attendee limit for at least one meeting. Review that meeting’s invited people, then preview again."
      : "Reconciliation could not be applied. No Google or reminder jobs were processed by this request.";
    return Response.json({error:message},{status:503,headers:calendarHeaders});
  }
  return Response.json({result:result.data},{headers:calendarHeaders});
}
