/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS isolated verification harness, matching existing scripts. */
// Isolated transport/database fixtures. No environment loading or network calls.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
test('Bell export and reminder model parse as complete modules before transpilation',()=>{
 const parse=(source,file)=>ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 for(const file of ['src/app/dashboard/notifications/bell.tsx','src/lib/calendar-reminders/model.ts']){
  const source=parse(fs.readFileSync(path.join(root,file),'utf8'),file);
  assert.deepEqual(source.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[],file);
  const exported=source.statements.filter(s=>s.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword));
  assert(exported.some(s=>s.name?.text===(file.endsWith('bell.tsx')?'NotificationBell':'reminderSchedule')),`Missing top-level export in ${file}`);
 }
 const modelSource=fs.readFileSync(path.join(root,'src/lib/calendar-reminders/model.ts'),'utf8').replace(/\r\n/g,'\n');
 const broken=modelSource.replace('  });\n}\nexport function mostRelevantDue','  });\nexport function mostRelevantDue');
 assert.notEqual(broken,modelSource);
 assert(parse(broken,'model.ts').parseDiagnostics.length>0,'Regression fixture must detect the missing closing brace');
});
for(const ext of ['.ts','.tsx']) require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
const model=require('../src/lib/calendar-reminders/model.ts'),{runCalendarCycle}=require('../src/lib/calendar-reminders/cycle.ts');
const start=Date.parse('2030-11-20T12:00:00+01:00');
test('All three stages use stored instant and injected time',()=>{
 const jobs=model.reminderSchedule(new Date(start).toISOString(),start-7200000);
 assert.deepEqual(jobs.map(j=>j.lead),[60,10,0]);
 for(const job of jobs)assert.equal(model.mostRelevantDue(jobs,job.due+60000).lead,job.lead);
 assert.equal(model.reminderLabel(10,new Date(start).toISOString(),start-600000),'Starts in 10 minutes.');
});
test('Short notice skips past stages; downtime never releases stale start alerts',()=>{
 const jobs=model.reminderSchedule(new Date(start).toISOString(),start-300000);
 assert.deepEqual(jobs.map(j=>j.state),['skipped','skipped','scheduled']);
 assert.equal(model.mostRelevantDue(jobs,start+120001),null);
 assert.equal(model.reminderLabel(0,new Date(start).toISOString(),start+120001),'Start-time reminder');
});
test('Recovery chooses only latest relevant stage and grace boundary is explicit',()=>{
 assert.equal(model.mostRelevantDue([{lead:60,due:start-10000},{lead:10,due:start}],start).lead,10);
 assert.equal(model.mostRelevantDue([{lead:0,due:start}],start+120000).lead,0);
});
const counts={available:true,delivered:2,skipped:1,checked:1,group_delivery:'pending_private_groups'};
test('Bounded reminder batches surround Google and expose aggregate counts only',async()=>{
 const order=[];const result=await runCalendarCycle(async()=>{order.push('google');return {processed:1,recorded:1}},async()=>{order.push('reminders');return counts});
 assert.deepEqual(order,['reminders','google','reminders']);assert.equal(result.reminders.delivered,4);assert.equal(result.syncFailed,false);
});
test('Reminder outage cannot starve Google; Google outage cannot suppress reminders',async()=>{
 let google=0,reminders=0;
 const a=await runCalendarCycle(async()=>{google++;return {processed:0,recorded:0}},async()=>{throw Error('fixture')});assert.equal(google,1);assert.equal(a.reminders.available,false);
 const b=await runCalendarCycle(async()=>{throw Error('fixture')},async()=>{reminders++;return counts});assert.equal(reminders,2);assert.equal(b.syncFailed,true);assert.equal(b.reminders.delivered,4);
});
function load(file,stubs){const filename=path.join(root,file);delete require.cache[filename];const original=Module._load;try{Module._load=function(name,...args){if(Object.hasOwn(stubs,name))return stubs[name];return original.call(this,name,...args)};return require(filename)}finally{Module._load=original}}
const id='12345678-1234-4234-8234-123456789abc';
test('Real reminder adapter never sends a request clock and hides malformed/error results',async()=>{
 let data={delivered:2,skipped:0,checked:1},error=null,calls=0;
 const adapter=load('src/lib/calendar-reminders/server.ts',{'server-only':{},'../../app/dashboard/calendar/server':{calendarAdmin:()=>({rpc:(name,args)=>{calls++;assert.equal(name,'calendar_deliver_reminders');assert.deepEqual(args,{p_limit:10});return {abortSignal:async signal=>{assert(signal instanceof AbortSignal);return {data,error}}}}})}});
 assert.equal((await adapter.runCalendarReminders()).delivered,2);
 data={delivered:'PRIVATE',skipped:0,checked:1};assert.equal((await adapter.runCalendarReminders()).available,false);
 error={message:'PRIVATE'};assert.equal((await adapter.runCalendarReminders()).available,false);assert.equal(calls,3);
});
test('Real protected Join handler denies outsider, inactive session, cancelled and missing links',async()=>{
 let signed=true,meeting=null;
 const route=load('src/app/dashboard/calendar/api/[id]/join/route.ts',{'../../../join-window':{joinWindow:m=>require('../src/app/dashboard/calendar/join-window.ts').joinWindow({...m,starts_at:new Date(start).toISOString(),ends_at:new Date(start+3600000).toISOString()},start)},'../../../server':{calendarHeaders:{'Cache-Control':'private, no-store'},calendarAuth:async()=>signed?{client:{},user:{id:'fixture'}}:null,findMeeting:async()=>({data:meeting,error:null})}});
 const run=()=>route.GET(new Request('http://localhost:3000'),{params:Promise.resolve({id})});
 assert.equal((await run()).status,404);signed=false;assert.equal((await run()).status,401);signed=true;
 meeting={status:'cancelled',join_url:'https://meet.google.com/abc-defg-hij'};assert.equal((await run()).status,404);
 meeting={status:'scheduled',join_url:null};assert.equal((await run()).status,409);
 meeting.join_url='https://attacker.invalid';assert.equal((await run()).status,409);
 meeting.join_url='https://meet.google.com/abc-defg-hij';const response=await run();assert.equal(response.status,303);assert.equal(response.headers.get('location'),meeting.join_url);
});
test('Real bell preserves legacy alerts, protected links, mark read and cancelled suppression',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 let rows=[{id:1,approval_id:'approval',created_at:new Date(start).toISOString(),read_at:null},{id:2,conversation_id:'private',created_at:new Date(start).toISOString(),read_at:null}];
 const query={select(){return this},order(){return this},limit(){return this},in(){return this},overrideTypes:async()=>({data:rows,error:null}),is:async()=>({count:2,error:null})};
 const {NotificationBell}=load('src/app/dashboard/notifications/bell.tsx',{'./use-meeting-clock':{useMeetingClock:()=>start},'next/link':{default:({href,children})=>React.createElement('a',{href:typeof href==='string'?href:href.pathname},children)},'../../../lib/staff-auth':{createStaffClient:async()=>({from:()=>query})},'../navigation':{DashboardIcon:()=>null},'./controls':{MarkRead:({label})=>React.createElement('button',null,label),NotificationUpdates:()=>null}});
 let html=renderToStaticMarkup(await NotificationBell({role:'Admin'}));assert.match(html,/New approval request/);assert.match(html,/New direct message/);assert.match(html,/Mark all as read/);
 rows=[{id:3,calendar_occurrence_id:id,calendar_lead_minutes:10,read_at:null,calendar_occurrences:{id,title:'Private fixture',starts_at:new Date(start).toISOString(),ends_at:new Date(start+3600000).toISOString(),status:'scheduled',join_url:'https://meet.google.com/abc-defg-hij'}}];
 html=renderToStaticMarkup(await NotificationBell({role:'Admin'}));assert.match(html,/Private fixture/);assert.match(html,/Lagos/);assert.match(html,/Join Meeting/);assert.match(html,new RegExp(`/api/${id}/join`));assert(!html.includes('href="https://meet.google.com'));
 rows[0].calendar_occurrences.status='cancelled';html=renderToStaticMarkup(await NotificationBell({role:'Admin'}));assert.match(html,/Meeting cancelled/);assert(!html.includes('Join Meeting'));
 rows[0].calendar_occurrences=null;html=renderToStaticMarkup(await NotificationBell({role:'Admin'}));assert(!html.includes('Private fixture'));
});
test('Forward SQL contract keeps durable atomic dedup, occurrence locks and private role grants',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261117010000_calendar_part3_private_reminders.sql'),'utf8');
 for(const pattern of [/for update of c skip locked/i,/unique\(occurrence_id,schedule_revision,user_id,lead_minutes,channel\)/,/hub_calendar_reminder_once/,/as restrictive for all to authenticated/,/o.reminder_revision=calendar_revision/,/status='sent',delivered_at/,/interval '2 minutes'/,/grant select\(id,email,email_confirmed_at,deleted_at,banned_until\)/,/revoke all on public.calendar_reminders from public,anon,authenticated/])assert.match(sql,pattern);
 assert(!/insert into public.connect_messages/i.test(sql));
});
