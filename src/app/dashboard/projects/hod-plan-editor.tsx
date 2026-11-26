"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanAssignee } from "./assignees";

type WorkItem = { id?: string | null; title: string; assignee_user_id: string | null; due_date: string | null; status: string };
type Plan = { id: string; title: string; summary: string; version: number; department: string; period_kind: "week"|"month"|"year"; period_start: string; department_plan_items: WorkItem[] };

export function HodPlanEditor({ department, period, periodStart, existing, assignees, assigneesReady }: {
  department: string; period: "week"|"month"|"year"; periodStart: string; existing: Plan | null;
  assignees: PlanAssignee[]; assigneesReady: boolean;
}) {
  const router = useRouter(), dialog = useRef<HTMLDialogElement>(null), requestId = useRef<string|null>(null);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [title,setTitle]=useState(existing?.title??""),[summary,setSummary]=useState(existing?.summary??"");
  const [items,setItems]=useState<WorkItem[]>(existing?.department_plan_items??[]);
  function begin(){setTitle(existing?.title??"");setSummary(existing?.summary??"");setItems(existing?.department_plan_items??[]);setError("");setNotice("");setOpen(true);setTimeout(()=>dialog.current?.showModal(),0)}
  function change(update:()=>void){requestId.current=null;update()}
  function addItem(){change(()=>setItems((current)=>[...current,{title:"",assignee_user_id:"",due_date:null,status:"not_started"}]))}
  function updateItem(index:number,patch:Partial<WorkItem>){change(()=>setItems((current)=>current.map((item,i)=>i===index?{...item,...patch}:item)))}
  function removeItem(index:number){change(()=>setItems((current)=>current.filter((_,i)=>i!==index)))}
  async function save(submit:boolean){
    if(busy)return;setBusy(true);setError("");setNotice("");
    requestId.current??=crypto.randomUUID();
    try{
      const response=await fetch("/dashboard/projects/api",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({
        requestId:requestId.current,department,period,periodStart,planId:existing?.id??null,expectedVersion:existing?.version??null,
        title,summary,items,submit,
      })});
      const value=await response.json();if(!response.ok)throw new Error(value.error??"Plan could not be saved.");
      setNotice(submit?"Plan submitted for CEO/Admin oversight.":"Draft saved.");dialog.current?.close();setOpen(false);router.refresh();
    }catch(failure){setError(failure instanceof Error?failure.message:"Plan could not be saved. Retry when connected.")}
    finally{setBusy(false)}
  }
  return <>
    <button type="button" className="eba-plans__edit" onClick={begin}>{existing?"Edit draft":"Create department plan"}</button>
    {notice&&<p role="status">{notice}</p>}
    {open&&<dialog className="hod-plan-dialog" ref={dialog} aria-labelledby="hod-plan-title" onCancel={(event)=>{event.preventDefault();if(!busy){dialog.current?.close();setOpen(false)}}}>
      <header><div><p className="eba-plans__eyebrow">{department} · {period} starting {periodStart}</p><h2 id="hod-plan-title">{existing?"Edit draft plan":"Create department plan"}</h2></div><button type="button" disabled={busy} aria-label="Close plan editor" onClick={()=>{dialog.current?.close();setOpen(false)}}>×</button></header>
      {error&&<p role="alert">{error}</p>}
      {!assigneesReady&&<p role="status">Member assignment options are unavailable. Retry after checking workspace setup.</p>}
      <label>Plan title<input value={title} maxLength={160} required onChange={(event)=>change(()=>setTitle(event.target.value))}/></label>
      <label>Summary<textarea rows={4} maxLength={4000} value={summary} onChange={(event)=>change(()=>setSummary(event.target.value))}/></label>
      <section className="hod-plan-tasks" aria-labelledby="hod-plan-items"><header><div><h3 id="hod-plan-items">Work items</h3><p>Assign each item to an active person in this department.</p></div><button type="button" disabled={busy||items.length>=50} onClick={addItem}>Add item</button></header>
        {!items.length&&<p>No work items yet. Add work when you are ready.</p>}
        {items.map((item,index)=><fieldset key={item.id??index} disabled={busy}><legend>Work item {index+1}</legend><label>Title<input required maxLength={160} value={item.title} onChange={(event)=>updateItem(index,{title:event.target.value})}/></label>
          <label>Assigned person<select required value={item.assignee_user_id??""} onChange={(event)=>updateItem(index,{assignee_user_id:event.target.value||null})}><option value="">Choose an active member</option>{Array.from(new Map(assignees.map((person)=>[person.user_id,person])).values()).map((person)=><option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></label>
          <label>Due date · optional<input type="date" value={item.due_date??""} onChange={(event)=>updateItem(index,{due_date:event.target.value||null})}/></label>
          <label>Status<select value={item.status} onChange={(event)=>updateItem(index,{status:event.target.value as WorkItem["status"]})}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option></select></label>
          <button type="button" onClick={()=>removeItem(index)}>Remove item</button></fieldset>)}
      </section>
      <p>Submitting makes the plan read-only in this HOD workspace. CEO/Admin oversight remains available.</p>
      <footer><button type="button" disabled={busy} onClick={()=>{dialog.current?.close();setOpen(false)}}>Cancel</button><button type="button" disabled={busy||!assigneesReady} onClick={()=>void save(false)}>{busy?"Saving…":"Save draft"}</button><button type="button" className="eba-plans__submit" disabled={busy||!assigneesReady} onClick={()=>void save(true)}>{busy?"Saving…":"Submit plan"}</button></footer>
    </dialog>}
  </>;
}
