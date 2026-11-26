"use client";
import {useRouter} from "next/navigation";
import {useState} from "react";
import type {ChangeEvent,FormEvent} from "react";

export function HodRequestForm({departments}:{departments:{id:string;label:string}[]}){
 const router=useRouter();const [pending,setPending]=useState(false),[message,setMessage]=useState("");
 const [type,setType]=useState("graphics");
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending)return;setPending(true);setMessage("");
  try{const response=await fetch("/dashboard/approvals/api",{method:"POST",body:new FormData(event.currentTarget),credentials:"same-origin"});const result=await response.json();
   if(!response.ok)throw Error(result.error??"Request could not be submitted.");setMessage("Request submitted. You can track its status below.");event.currentTarget.reset();setType("graphics");router.refresh();
  }catch(error){setMessage(error instanceof Error?error.message:"Request could not be submitted. Retry.")}
  finally{setPending(false)}
 }
 function changeType(event:ChangeEvent<HTMLSelectElement>){setType(event.target.value)}
 return <form className="eba-hod-request" onSubmit={submit}>
  <h2>Submit a request</h2>
  <label>Request type<select name="requestType" value={type} onChange={changeType}><option value="graphics">Graphics review</option><option value="marketing">Marketing request</option><option value="website">Website review</option><option value="leave">Leave request</option><option value="sick">Sick notice</option><option value="absence">Absence notice</option></select></label>
  <label>Department<select name="department" required defaultValue=""><option value="" disabled>Select a department</option>{departments.map((department)=><option key={department.id} value={department.id}>{department.label}</option>)}</select></label>
  <label>Title<input name="title" maxLength={160} required/></label>
  <label>Details<textarea name="message" maxLength={5000} rows={5} required/></label>
  {type==="website"||type==="marketing"?<label>Supporting HTTPS link (optional)<input name="externalUrl" type="url" inputMode="url" placeholder="https://…"/></label>:<input type="hidden" name="externalUrl" value=""/>}
  {["leave","sick","absence"].includes(type)&&<div className="eba-hod-request__dates"><label>Start date<input name="startDate" type="date" required/></label><label>End date<input name="endDate" type="date" required/></label></div>}
  {type==="leave"&&<p>Leave requests require a supporting document. Only you and authorized reviewers can access it.</p>}
  <label>Supporting files{type==="leave"&&<span> · Required</span>}<input type="file" name="files" multiple accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"/></label>
  {message&&<p role={message.startsWith("Request submitted")?"status":"alert"}>{message}</p>}
  <button type="submit" disabled={pending||departments.length===0}>{pending?"Submitting…":"Submit request"}</button>
 </form>;
}
