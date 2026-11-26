"use client";

import Link from "next/link";
import { useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { manageAnnouncement,type AnnouncementPayload } from "./actions";
import { departmentNames } from "../connect/model";

const departments=Object.entries(departmentNames);
const dateTime=new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Lagos"});
type Audit={action:string;actor_id:string;created_at:string;revision:number};
export type AnnouncementRecord={id:string;author_id:string;author_name:string;status:"draft"|"published"|"archived";current_revision:number;revision:number;title:string;body:string;audience_type:"company"|"departments";departments:string[];expires_at:string|null;published_at:string|null;audit:Audit[]};
type View="published"|"drafts"|"archived";
type Screen="edit"|"preview"|"publish"|"archive"|"discard";
const emptyPayload:AnnouncementPayload={title:"",body:"",audience_type:"company",departments:[],expires_at:null};
function audienceLabel(value:Pick<AnnouncementPayload,"audience_type"|"departments">){return value.audience_type==="company"?"Everyone in the company":value.departments.map((id)=>departmentNames[id]??id).join(", ")||"Choose at least one department";}
function excerpt(body:string){return body.length>200?body.slice(0,200).trimEnd()+"…":body;}
function dateField(value:string|null){if(!value)return "";const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}

export function AnnouncementManager({view,records,error,totals,totalsAvailable,currentUserId}:{view:View;records:AnnouncementRecord[];error:boolean;totals:{published:number|null;drafts:number|null;archived:number|null};totalsAvailable:boolean;currentUserId:string}){
  const router=useRouter();const panel=useRef<HTMLDialogElement>(null);const trigger=useRef<HTMLElement|null>(null);const requestId=useRef("");const baseline=useRef("");const previewFromEditor=useRef(false);
  const [record,setRecord]=useState<AnnouncementRecord|null>(null);const [screen,setScreen]=useState<Screen>("edit");const [form,setForm]=useState<AnnouncementPayload>(emptyPayload);
  const [search,setSearch]=useState("");const [audienceFilter,setAudienceFilter]=useState("all");const [actionError,setActionError]=useState("");const [notice,setNotice]=useState("");const [pending,startTransition]=useTransition();
  const dirty=()=>JSON.stringify(form)!==baseline.current;
  const close=()=>{panel.current?.close();requestAnimationFrame(()=>trigger.current?.focus());setRecord(null);setActionError("");};
  const requestClose=()=>{if(screen==="discard")return;if(dirty())setScreen("discard");else close();};
  const open=(next:Screen,source:HTMLElement|null,selected:AnnouncementRecord|null=null,values:AnnouncementPayload=emptyPayload)=>{
    trigger.current=source;previewFromEditor.current=false;setNotice("");setRecord(selected);setForm(values);baseline.current=JSON.stringify(values);setScreen(next);setActionError("");panel.current?.showModal();
  };
  const update=(value:Partial<AnnouncementPayload>)=>setForm((current)=>({...current,...value}));
  const audience=audienceLabel(form);
  const filtered=records.filter((item)=>item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())&&(audienceFilter==="all"||item.audience_type===audienceFilter));
  const tabs:{[K in View]:string}={published:"Published",drafts:"Drafts",archived:"Archived"};
  const empty:{[K in View]:string}={published:"No published announcements yet.",drafts:"No drafts yet. Create an announcement when you’re ready.",archived:"No archived announcements."};

  function save(action:"create"|"create_publish"|"edit"|"publish"|"archive"){
    setActionError("");startTransition(async()=>{
      try{
        if((action==="create"||action==="create_publish")&&!requestId.current)requestId.current=crypto.randomUUID();
        const payload:AnnouncementPayload={...form,departments:form.audience_type==="departments"?[...new Set(form.departments)]:[],expires_at:form.expires_at||null};
        const result=await manageAnnouncement(action,record?.id??null,record?.revision??null,["create","create_publish","edit"].includes(action)?payload:undefined,requestId.current||undefined);
        if(result.error){setActionError(result.error);return;}
        const wasPublishedEdit=action==="edit"&&record?.status==="published";
        setNotice(wasPublishedEdit?"Saved as a new draft revision. Review it in Drafts, then publish when ready.":"");requestId.current="";close();
        if(wasPublishedEdit)router.push("/dashboard/announcements?view=drafts");else router.refresh();
      }catch{setActionError("Request failed. Your changes were not confirmed; retry or reload.");}
    });
  }

  return <section className="eba-announcements" aria-labelledby="announcements-heading">
    <header className="eba-announcements__hero"><div><span className="eba-announcements__eyebrow">MANAGEMENT</span><h1 id="announcements-heading">Announcements</h1><p>Share updates with your team.</p><Link href="/dashboard/announcements/history">Recipient history <span aria-hidden="true">→</span></Link></div>
      <button className="eba-announcements__primary" type="button" onClick={(event)=>{requestId.current="";setNotice("");open("edit",event.currentTarget);}}>＋ New announcement</button></header>
    {notice&&<p className="eba-announcements__notice" role="status">{notice}</p>}
    <nav className="eba-announcements__tabs" aria-label="Announcement status">{(["published","drafts","archived"] as const).map((key)=><Link key={key} href={`/dashboard/announcements?view=${key}`} aria-current={view===key?"page":undefined}>{tabs[key]}{totalsAvailable&&totals[key]!==null&&<span>{totals[key]}</span>}</Link>)}</nav>
    <div className="eba-announcements__toolbar"><label>Search title<input type="search" value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search announcements"/></label><label>Audience<select value={audienceFilter} onChange={(event)=>setAudienceFilter(event.target.value)}><option value="all">All audiences</option><option value="company">Company-wide</option><option value="departments">Departments</option></select></label></div>
    {error?<div className="eba-announcements__empty" role="alert"><strong>Announcements couldn’t be loaded.</strong><p>Your records are safe. Retry the request.</p><button type="button" onClick={()=>router.refresh()}>Retry</button></div>:filtered.length===0?<div className="eba-announcements__empty"><strong>{records.length?"No announcements match these filters.":empty[view]}</strong>{view==="drafts"&&!records.length&&<p>Drafts are visible only to their author.</p>}</div>:<>
      {totalsAvailable&&totals[view]!==null&&<p className="eba-announcements__total">{filtered.length} shown · {totals[view]} {view} total{records.length>=1000&&totals[view]!>records.length?" · Showing the latest 1,000; narrow your search to refine these results.":""}</p>}
      <div className="eba-announcements__list">{filtered.map((item)=>{
        const own=item.author_id===currentUserId;const values:AnnouncementPayload={title:item.title,body:item.body,audience_type:item.audience_type,departments:item.departments,expires_at:item.expires_at};
        return <article key={item.id} className="eba-announcements__record">
          <div className="eba-announcements__record-heading"><div><span className={`eba-announcements__badge eba-announcements__badge--${item.status}`}>{item.status}</span><h2>{item.title}</h2></div><span className="eba-announcements__revision">Revision {item.revision}</span></div>
          <p className="eba-announcements__excerpt">{excerpt(item.body)}</p>
          <div className="eba-announcements__metadata"><span>Author<strong>{item.author_name}</strong></span><span>Audience<strong>{audienceLabel(item)}</strong></span>{item.published_at&&<span>Published<strong>{dateTime.format(new Date(item.published_at))}</strong></span>}{item.expires_at&&<span>Expires<strong>{dateTime.format(new Date(item.expires_at))}</strong></span>}</div>
          <div className="eba-announcements__row-actions"><button type="button" onClick={(event)=>{previewFromEditor.current=false;open("preview",event.currentTarget,item,values);}}>View</button>{own&&item.status!=="archived"&&<button type="button" onClick={(event)=>open("edit",event.currentTarget,item,values)}>Edit</button>}{own&&item.status==="draft"&&<button type="button" className="eba-announcements__action-primary" onClick={(event)=>open("publish",event.currentTarget,item,values)}>Publish</button>}{own&&item.status==="published"&&<button type="button" onClick={(event)=>open("archive",event.currentTarget,item,values)}>Archive</button>}</div>
          {item.audit.length>0&&<details className="eba-announcements__audit"><summary>Audit trail</summary><ul>{item.audit.map((event,index)=><li key={`${event.created_at}:${index}`}>{event.action.replaceAll("_"," ")} · {event.actor_id===item.author_id?"author":"manager"} · {dateTime.format(new Date(event.created_at))} · revision {event.revision}</li>)}</ul></details>}
        </article>;
      })}</div>
    </>}

    <dialog ref={panel} className="eba-announcements__panel" aria-labelledby="announcement-panel-title" onCancel={(event)=>{event.preventDefault();requestClose();}}>
      <header className="eba-announcements__panel-header"><div><span className="eba-announcements__eyebrow">{screen==="preview"?"RECIPIENT VIEW":screen==="publish"?"CONFIRM PUBLICATION":screen==="archive"?"ARCHIVE":screen==="discard"?"UNSAVED CHANGES":"ANNOUNCEMENT EDITOR"}</span><h2 id="announcement-panel-title">{screen==="preview"?"Preview announcement":screen==="publish"?"Publish announcement?":screen==="archive"?"Archive announcement?":screen==="discard"?"Discard changes?":record?"Edit announcement":"New announcement"}</h2></div><button type="button" className="eba-announcements__close" aria-label="Close announcement panel" onClick={requestClose}>×</button></header>
      {screen==="edit"&&<>
        <div className="eba-announcements__form"><label htmlFor="announcement-title">Title</label><input id="announcement-title" autoFocus maxLength={160} value={form.title} onChange={(event)=>update({title:event.target.value})} placeholder="A clear, specific title"/>
          <label htmlFor="announcement-body">Message</label><textarea id="announcement-body" maxLength={12000} rows={12} value={form.body} onChange={(event)=>update({body:event.target.value})} placeholder="Write your update…"/>
          <fieldset><legend>Audience</legend><label className="eba-announcements__choice"><input type="radio" name="announcement-audience" checked={form.audience_type==="company"} onChange={()=>update({audience_type:"company",departments:[]})}/>Company-wide</label><label className="eba-announcements__choice"><input type="radio" name="announcement-audience" checked={form.audience_type==="departments"} onChange={()=>update({audience_type:"departments"})}/>Selected departments</label>
            {form.audience_type==="departments"&&<div className="eba-announcements__departments">{departments.map(([id,name])=><label className="eba-announcements__choice" key={id}><input type="checkbox" checked={form.departments.includes(id)} onChange={(event)=>update({departments:event.target.checked?[...form.departments,id]:form.departments.filter((value)=>value!==id)})}/>{name}</label>)}</div>}
          </fieldset><p className="eba-announcements__audience-summary"><strong>Selected audience</strong>{audience}<small>Recipients are checked against current active department assignments when they open this announcement.</small></p>
          <label htmlFor="announcement-expiry">Expiry <span>Optional</span></label><input id="announcement-expiry" type="datetime-local" value={dateField(form.expires_at)} onChange={(event)=>update({expires_at:event.target.value?new Date(event.target.value).toISOString():null})}/>
        </div>
        {actionError&&<p className="eba-announcements__error" role="alert">{actionError}</p>}
        <footer className="eba-announcements__panel-actions"><button type="button" onClick={()=>{previewFromEditor.current=true;setScreen("preview");}}>Preview</button><button type="button" disabled={pending} onClick={()=>save(record?"edit":"create")}>{pending?"Saving…":record?"Save changes":"Save draft"}</button>{record?.status!=="published"&&<button type="button" className="eba-announcements__action-primary" disabled={pending} onClick={()=>setScreen("publish")}>Publish…</button>}</footer>
      </>}
      {screen==="preview"&&<div className="eba-announcements__preview"><p className="eba-announcements__preview-label">PREVIEW · RECIPIENT VIEW</p><div className="eba-announcement-prompt__accent" aria-hidden="true"/><p className="eba-announcement-prompt__eyebrow">EBA HUB · ANNOUNCEMENT</p><h3>{form.title||"Announcement title"}</h3><div className="eba-announcement-prompt__body">{form.body||"Your message will appear here."}</div><div className="eba-announcement-prompt__sender"><span>From <strong>EBA Hub</strong></span><span>{record?.published_at?`Published ${dateTime.format(new Date(record.published_at))}`:"Publication date shown after publishing"}</span></div><footer><button type="button" onClick={()=>previewFromEditor.current?setScreen("edit"):close()}>Got it</button></footer></div>}
      {screen==="publish"&&<div className="eba-announcements__confirmation"><p>Publish this announcement to:</p><strong>{audience}</strong><p>{form.expires_at?`It will expire ${dateTime.format(new Date(form.expires_at))}.`:"It will remain available until archived."}</p>{actionError&&<p role="alert" className="eba-announcements__error">{actionError}</p>}<footer><button type="button" onClick={()=>setScreen("edit")}>Back</button><button type="button" className="eba-announcements__action-primary" disabled={pending} onClick={()=>save(record?"publish":"create_publish")}>{pending?"Publishing…":"Confirm publish"}</button></footer></div>}
      {screen==="archive"&&<div className="eba-announcements__confirmation"><p>Archive <strong>{record?.title}</strong>?</p><p>It will no longer be available in recipient history or pop-ups.</p>{actionError&&<p role="alert" className="eba-announcements__error">{actionError}</p>}<footer><button type="button" onClick={()=>setScreen("preview")}>Cancel</button><button type="button" className="eba-announcements__action-primary" disabled={pending} onClick={()=>save("archive")}>{pending?"Archiving…":"Confirm archive"}</button></footer></div>}
      {screen==="discard"&&<div className="eba-announcements__confirmation"><p>You have unsaved changes. Discard them?</p><footer><button type="button" onClick={()=>setScreen("edit")}>Keep editing</button><button type="button" onClick={close}>Discard changes</button></footer></div>}
    </dialog>
  </section>;
}
