"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Item = { id: string; revision: number; title: string; body: string; published_at: string };
const dateTime=new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Lagos"});
function blocked() {
  return Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [data-announcement-block="true"]'))
    || Boolean(document.activeElement?.closest("input,textarea,select,[contenteditable='true']"));
}

export function AnnouncementPrompt() {
  const [item,setItem]=useState<Item|null>(null); const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null); const restore=useRef<HTMLElement|null>(null); const busy=useRef(false);
  const itemRef=useRef<Item|null>(null);
  const fetchNext=useCallback(async()=>{
    if(busy.current||document.visibilityState==="hidden")return;
    busy.current=true;
    try {
      const response=await fetch("/dashboard/announcements/api/next",{cache:"no-store",credentials:"same-origin"});
      if(!response.ok)throw new Error("unavailable");
      const payload=await response.json() as {announcement:Item|null}; setError("");
      if(!payload.announcement&&dialog.current?.open){dialog.current.close();requestAnimationFrame(()=>restore.current?.focus());}
      itemRef.current=payload.announcement;setItem(payload.announcement);
      if(payload.announcement)requestAnimationFrame(()=>{
        if(itemRef.current&&!blocked()&&dialog.current&&!dialog.current.open){restore.current=document.activeElement instanceof HTMLElement?document.activeElement:null;dialog.current.showModal();}
      });
    } catch { setError("Announcements are temporarily unavailable."); }
    finally {busy.current=false;}
  },[]);
  useEffect(()=>{
    const initial=window.setTimeout(()=>void fetchNext(),0); const interval=window.setInterval(()=>void fetchNext(),15000);
    const check=()=>{if(itemRef.current&&!blocked()&&dialog.current&&!dialog.current.open){restore.current=document.activeElement instanceof HTMLElement?document.activeElement:null;dialog.current.showModal();}};
    const retry=()=>void fetchNext(); const free=()=>window.setTimeout(check,250);
    document.addEventListener("visibilitychange",retry); window.addEventListener("focus",retry); document.addEventListener("focusout",free);
    const observer=new MutationObserver(check); observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["open","data-announcement-block"]});
    check(); return()=>{clearTimeout(initial);clearInterval(interval);document.removeEventListener("visibilitychange",retry);window.removeEventListener("focus",retry);document.removeEventListener("focusout",free);observer.disconnect();};
  },[fetchNext]);
  async function acknowledge(){
    if(!item||saving)return;setSaving(true);setError("");
    try{
      const response=await fetch("/dashboard/announcements/api/acknowledge",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:item.id,revision:item.revision})});
      if(!response.ok)throw new Error("failed");
      dialog.current?.close();itemRef.current=null;setItem(null);requestAnimationFrame(()=>restore.current?.focus());window.setTimeout(()=>void fetchNext(),100);
    }catch{setError("Your acknowledgement could not be saved. Retry to continue.");}finally{setSaving(false);}
  }
  return <>
    {item&&<dialog ref={dialog} className="eba-announcement-prompt" aria-labelledby="eba-announcement-title" aria-describedby="eba-announcement-message" onCancel={(e)=>e.preventDefault()}>
      <div className="eba-announcement-prompt__accent" aria-hidden="true"/><p className="eba-announcement-prompt__eyebrow">EBA HUB · ANNOUNCEMENT</p><h2 id="eba-announcement-title">{item.title}</h2><div className="eba-announcement-prompt__sender"><strong>From EBA Hub</strong><time dateTime={item.published_at}>Published {dateTime.format(new Date(item.published_at))} · Lagos</time></div><div id="eba-announcement-message" className="eba-announcement-prompt__body">{item.body}</div>
      {error&&<p role="alert">{error}</p>}<footer><button type="button" onClick={acknowledge} disabled={saving}>{saving?"Saving…":"Got it"}</button></footer>
    </dialog>}
    {!item&&error&&<span className="eba-announcement-prompt__status" role="status">{error}</span>}
  </>;
}
