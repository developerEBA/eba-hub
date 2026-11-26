
/* eslint-disable @typescript-eslint/no-require-imports */
const {loadEnvConfig}=require('@next/env'),{createClient}=require('@supabase/supabase-js');
loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const flags={url_present:!!process.env.NEXT_PUBLIC_SUPABASE_URL,server_key_present:!!(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY),app_origin_present:!!process.env.EBA_APP_URL};
const classify=error=>({code:/^[A-Z0-9]{5,12}$/.test(error?.code??'')?error.code:'unclassified',
 ambiguous_target:/column reference ["']?target["']? is ambiguous/i.test(error?.message??''),
 permission_denied:/permission denied/i.test(error?.message??''),authorization_denied:/Active management account required/i.test(error?.message??'')});
(async()=>{
 console.log(JSON.stringify({configuration:flags}));if(!flags.url_present||!flags.server_key_present)return;
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const columns={staff_memberships:'user_id,role,status,access_version',staff_access_profiles:'user_id,name',connect_profiles:'user_id,display_name',staff_department_assignments:'user_id,department',staff_access_invites:'id,name,email,role,department,status,expires_at,account_id,created_at',staff_access_audit:'id,actor,action,target,created_at'};
 const permissions=[];for(const [table,fields] of Object.entries(columns)){
  let r;for(let attempt=0;attempt<2;attempt++){
   r=await db.from(table).select(fields).limit(0).abortSignal(AbortSignal.timeout(10000));
   if(r.status!==0)break;
  }
  permissions.push({table,readable:!r.error,http_status:r.status,...(r.error?classify(r.error):{})});
 }console.log(JSON.stringify({directory_column_probes:permissions}));
 const selected=await db.from('staff_memberships').select('user_id,role').eq('status','active').in('role',['admin','ceo']).limit(10).abortSignal(AbortSignal.timeout(10000));
 if(selected.error){console.log(JSON.stringify({stage:'actor_lookup',...classify(selected.error)}));return}
 const actor=selected.data.find(p=>p.role==='admin')??selected.data[0];
 if(!actor){console.log(JSON.stringify({stage:'actor_lookup',eligible_membership_found:false}));return}
 const result=await db.rpc('staff_access_control',{p_action:'directory',p_actor:actor.user_id,p_data:{}}).abortSignal(AbortSignal.timeout(10000));
 if(result.error)console.log(JSON.stringify({stage:'directory_rpc',http_status:result.status,...classify(result.error)}));
 else console.log(JSON.stringify({stage:'directory_rpc',http_status:result.status,valid_response:!!result.data&&Array.isArray(result.data.members)&&Array.isArray(result.data.invitations)&&Array.isArray(result.data.audit)&&typeof result.data.truncated==='boolean'}));
})().catch(()=>{console.log(JSON.stringify({stage:'transport',available:false}));process.exitCode=1});
