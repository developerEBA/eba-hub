"use client";
import {useEffect,useRef,useState} from "react";
export function InvitationForm(){
 const secret=useRef<{invite:string;token_hash:string;type:string}|null>(null);
 const [ready,setReady]=useState(false),[newAccount,setNewAccount]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{const fragment=new URLSearchParams(window.location.hash.slice(1));history.replaceState(null,"",window.location.pathname);
  const invite=fragment.get("invite"),token_hash=fragment.get("token_hash"),type=fragment.get("type");
  if(invite&&token_hash&&type&&/^[a-f0-9]{64}$/.test(invite)&&["invite","magiclink"].includes(type))secret.current={invite,token_hash,type};
  const timer=setTimeout(()=>{if(secret.current){setNewAccount(secret.current.type==="invite");setReady(true)}else setMessage("This invitation link is incomplete. Ask an Admin for a new link.")},0);
  return()=>clearTimeout(timer);
 },[]);
 return <section className="staff-accept"><p className="staff-eyebrow">ENI BRAND ARCHITECT</p><h1>Accept your staff invitation</h1><p>This invitation verifies its bound company email account. Employee and HOD dashboards are not released.</p>
  <form onSubmit={async e=>{e.preventDefault();if(!secret.current||pending)return;const values=new FormData(e.currentTarget);setPending(true);setMessage("");
   try{const response=await fetch("/staff/invitation/api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...secret.current,password:values.get("password")}),signal:AbortSignal.timeout(25000)}),result=await response.json();setMessage(result.message??result.error??"Acceptance unavailable.");if(response.ok){secret.current=null;setReady(false)}}catch{setMessage("Acceptance could not finish. Contact an Admin if the link was consumed before completion.")}finally{setPending(false)}
  }}>
   {newAccount&&<label>Choose your account password<input type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending||!ready}/><small>12–128 characters. Never share your password.</small></label>}
   <p>Only continue if this link was privately delivered to you for your own @enibrand.com account. It cannot be reassigned to another identity.</p>
   <button className="staff-primary" type="submit" disabled={!ready||pending}>{pending?"Verifying…":"Verify and accept invitation"}</button>
  </form>{message&&<p role="status" className="staff-notice">{message}</p>}<a href="/sign-in">Return to Hub sign-in</a>
 </section>;
}
