import { Suspense } from "react";
import { requireHodDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import DashboardLoading from "./loading";
import { AnnouncementManager, type AnnouncementRecord } from "./manager";
import { AnnouncementHistoryList, type AnnouncementHistoryEntry } from "./history-list";

type Props = { searchParams: Promise<{ view?: string }> };
type Row = { id:string; author_id:string; status:"draft"|"published"|"archived"; current_revision:number; created_at:string };
type Revision = { announcement_id:string; revision:number; title:string; body:string; audience_type:"company"|"departments"; departments:string[]; expires_at:string|null; published_at:string|null };
type Audit = { announcement_id:string; action:string; actor_id:string; created_at:string; revision:number };

export default function AnnouncementsPage(props:Props){return <Suspense fallback={<DashboardLoading/>}><ProtectedAnnouncements {...props}/></Suspense>;}

async function ProtectedAnnouncements({searchParams}:Props){
  const {client,user,role}=await requireHodDashboardAccess();
  if(role==="HOD"){
    const {data,error}=await client.rpc("announcement_history");
    const entries=Array.isArray(data)?data as AnnouncementHistoryEntry[]:[];
    return <DashboardShell role="HOD" section="announcements"><AnnouncementHistoryList entries={entries} error={Boolean(error)}/></DashboardShell>;
  }
  const query=await searchParams;
  const candidate=query.view;
  const view=candidate==="published"||candidate==="archived"?candidate:"drafts";
  const dbStatus=view==="drafts"?"draft":view;
  const [rowsResult,auditResult,publishedCount,draftCount,archivedCount]=await Promise.all([
    client.from("announcements").select("id,author_id,status,current_revision,created_at",{count:"exact"}).eq("status",dbStatus).order("updated_at",{ascending:false}).limit(1000),
    client.from("announcement_audit").select("announcement_id,revision,actor_id,action,created_at").order("id",{ascending:false}).limit(1000),
    ...(["published","draft","archived"] as const).map((status)=>client.from("announcements").select("id",{count:"exact",head:true}).eq("status",status)),
  ]);
  const rows=(rowsResult.data??[]) as Row[];
  const ids=rows.map((row)=>row.id);
  const [revisionResult,profilesResult]=await Promise.all([
    ids.length?client.from("announcement_revisions").select("announcement_id,revision,title,body,audience_type,departments,expires_at,published_at").in("announcement_id",ids):Promise.resolve({data:[],error:null}),
    ids.length?client.from("connect_profiles").select("user_id,display_name").in("user_id",[...new Set(rows.map((row)=>row.author_id))]):Promise.resolve({data:[],error:null}),
  ]);
  const revisions=(revisionResult.data??[]) as Revision[];
  const byCurrent=new Map(revisions.map((r)=>[`${r.announcement_id}:${r.revision}`,r]));
  const profileNames=new Map((profilesResult.data??[]).map((p)=>[p.user_id,p.display_name]));
  const records:AnnouncementRecord[]=rows.flatMap((row)=>{
    const revision=byCurrent.get(`${row.id}:${row.current_revision}`);
    return revision?[{...row,...revision,author_name:row.author_id===user.id?"You":profileNames.get(row.author_id)??"Another manager",audit:(auditResult.data??[] as Audit[]).filter((entry)=>entry.announcement_id===row.id)}]:[];
  });
  const error=Boolean(rowsResult.error||auditResult.error||revisionResult.error);
  return <DashboardShell role={role} section="announcements"><AnnouncementManager view={view} records={records} error={error}
    totals={{published:publishedCount.count,drafts:draftCount.count,archived:archivedCount.count}}
    totalsAvailable={!publishedCount.error&&!draftCount.error&&!archivedCount.error} currentUserId={user.id}/></DashboardShell>;
}
