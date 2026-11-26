
const actions=new Set(["directory","invite","bind","fail","revoke","inspect","verify_identity","accept","update","update_assignments","deactivate","reactivate","delete_member"]);
export function staffFailure(action:string,error:unknown){
 const e=error as {code?:unknown;message?:unknown;name?:unknown}|null;
 const message=typeof e?.message==="string"?e.message:"";
 const code=typeof e?.code==="string"&&/^[A-Z0-9]{5,12}$/.test(e.code)?e.code:"unclassified";
 const category=code==="STAFFRESP"?"invalid_response":code==="42702"?"ambiguous_sql_reference":code==="42501"?"database_permission":
  code==="P0001"&&/Active management account required|Active Admin required/.test(message)?"management_authorization":
  /PGRST20[23]|42883/.test(code)?"rpc_signature":e?.name==="AbortError"||e?.name==="TimeoutError"?"timeout":"rpc_failure";
 return {event:"staff_access_rpc",action:actions.has(action)?action:"unknown",code,category};
}
export function staffFailureMessage(action:string,error:unknown){
 const e=error as {code?:unknown;message?:unknown}|null;
 const message=typeof e?.message==="string"?e.message:"";
 const diagnostic=staffFailure(action,error);
 if(action==="delete_member"){
  if(diagnostic.category==="rpc_signature")return "Staff removal is unavailable on the server. Confirm the staff-directory deletion migration and its service-role grant, then retry.";
  if(diagnostic.category==="database_permission")return "The database denied staff removal. Confirm the deletion migration’s service-role permissions, then retry.";
  if(diagnostic.category==="management_authorization")return "Your Admin access is no longer active. Refresh the page and sign in again.";
  const known:Record<string,string>={
   "Staff record changed":"This staff record changed. Refresh the directory and try again.",
   "Staff record unavailable":"This staff record is no longer available. Refresh the directory.",
   "Staff account unavailable":"The staff account is unavailable. Refresh the directory.",
   "Cannot remove your own access":"You cannot remove your own staff access.",
   "Confirm staff removal first":"Confirm the staff removal in the dialog before retrying.",
   "Invalid staff record":"The staff record identifier is invalid. Refresh the directory.",
  };
  if(diagnostic.code==="P0001"&&known[message])return known[message];
 }
 return "Change could not be saved. Refresh and try again.";
}
export function directoryResponse(value:unknown){
 if(!value||typeof value!=="object")return false;
 const v=value as Record<string,unknown>;
 return Array.isArray(v.members)&&Array.isArray(v.invitations)&&Array.isArray(v.audit)&&typeof v.truncated==="boolean";
}
