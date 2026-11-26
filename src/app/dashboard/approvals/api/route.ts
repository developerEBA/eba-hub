import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requireHodDashboardAccess } from "../../access";

const requestTypes = new Set(["graphics", "marketing", "website", "leave", "sick", "absence"]);
const maxFileBytes = 10 * 1024 * 1024;

function privateAdmin() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
}

export async function POST(request:Request) {
  const headers={"Cache-Control":"private, no-store"};
  try {
    if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Request unavailable."},{status:403,headers});
    const {client,user,departments}=await requireHodDashboardAccess();
    const form=await request.formData();
    const title=typeof form.get("title")==="string"?String(form.get("title")).trim():"";
    const message=typeof form.get("message")==="string"?String(form.get("message")).trim():"";
    const type=String(form.get("requestType")??"");
    const department=String(form.get("department")??"");
    const external=String(form.get("externalUrl")??"").trim()||null;
    const start=String(form.get("startDate")??"")||null;
    const end=String(form.get("endDate")??"")||null;
    const files=form.getAll("files").filter((value):value is File=>value instanceof File&&value.size>0);
    if(!requestTypes.has(type)||!departments.includes(department)||title.length<1||title.length>160||message.length<1||message.length>5000||files.length>5)return Response.json({error:"Check the request type, department, title, message and attachments."},{status:400,headers});
    if(["leave","sick","absence"].includes(type)&&(!start||!end||end<start))return Response.json({error:"Enter a valid start and end date."},{status:400,headers});
    if(type==="leave"&&files.length===0)return Response.json({error:"Attach the required leave document."},{status:400,headers});
    if(external){try{const url=new URL(external);if(url.protocol!=="https:"||url.username||url.password)return Response.json({error:"Use a valid HTTPS supporting link."},{status:400,headers})}catch{return Response.json({error:"Use a valid HTTPS supporting link."},{status:400,headers})}}
    if(files.some((file)=>file.size>maxFileBytes||file.type&&!/^(image\/(png|jpeg|webp)|application\/pdf|text\/plain|application\/msword|application\/vnd\.openxmlformats-officedocument\.[a-z.]+)$/.test(file.type)))return Response.json({error:"An attachment has an unsupported format or is larger than 10 MB."},{status:400,headers});
    const profile=await client.from("connect_profiles").select("display_name").eq("user_id",user.id).maybeSingle();
    if(profile.error||!profile.data?.display_name)return Response.json({error:"Your verified Hub profile is not ready. Sign out and back in, then retry."},{status:503,headers});
    const admin=privateAdmin();if(!admin)return Response.json({error:"Request submission is temporarily unavailable."},{status:503,headers});
    const id=randomUUID(),uploaded:string[]=[],attachmentNames:string[]=[];
    try{
      for(const file of files){
        const extension=(file.name.match(/\.[a-z0-9]{1,10}$/i)?.[0]??"").toLowerCase();
        const filename=randomUUID()+extension,path=`${id}/${filename}`;
        const result=await admin.storage.from("approval-request-files").upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
        if(result.error)throw new Error("upload");uploaded.push(path);attachmentNames.push(filename);
      }
      const inserted=await client.from("approval_requests").insert({id,title,request_type:type,department,requester_id:user.id,
        requester_name:profile.data.display_name,message,external_url:external,start_date:start,end_date:end,attachment_names:attachmentNames,status:"pending"});
      if(inserted.error)throw new Error("insert");
      return Response.json({ok:true,id},{headers});
    }catch{
      if(uploaded.length)await admin.storage.from("approval-request-files").remove(uploaded);
      return Response.json({error:"Your request could not be submitted. No request was saved; correct the details or retry."},{status:503,headers});
    }
  }catch{return Response.json({error:"Your request could not be submitted. Refresh your HOD access and retry."},{status:401,headers})}
}
