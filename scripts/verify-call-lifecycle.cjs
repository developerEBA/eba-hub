/* eslint-disable @typescript-eslint/no-require-imports -- Isolated verification; no live calls. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
function load(file,stubs={}){const filename=path.join(root,file);delete require.cache[filename];const old=Module._load;try{Module._load=function(name,...args){return Object.hasOwn(stubs,name)?stubs[name]:old.call(this,name,...args)};return require(filename)}finally{Module._load=old}}
const {joinWindow}=require('../src/app/dashboard/calendar/join-window.ts'),{meetPresentation}=require('../src/app/dashboard/calendar/meet-model.ts');
const id='12345678-1234-4234-8234-123456789abc',email='admin@enibrand.com',url='https://meet.google.com/abc-defg-hij';
const start=Date.parse('2030-11-20T11:00:00Z'),end=start+3600000,closes=end+3*3600000;
const meeting=()=>({id,title:'Fixture',starts_at:new Date(start).toISOString(),ends_at:new Date(end).toISOString(),status:'scheduled',join_url:url,version:1,provider_calendar_id:email,provider_event_id:'event',sync_status:'synced'});
test('Join opens exactly at start and closes exactly three hours after end, including Lagos midnight',()=>{
 const m=meeting();for(const [now,state] of [[start-1,'waiting'],[start,'open'],[end,'open'],[closes-1,'open'],[closes,'expired'],[closes+1,'expired']])assert.equal(joinWindow(m,now).state,state);
 const overnight={...m,starts_at:'2030-11-20T23:30:00+01:00',ends_at:'2030-11-21T00:30:00+01:00'};
 assert.equal(joinWindow(overnight,Date.parse('2030-11-21T03:29:59+01:00')).state,'open');assert.equal(joinWindow(overnight,Date.parse('2030-11-21T03:30:00+01:00')).state,'expired');
});
test('Manual closure and cancellation override grace; next recurrence has an independent window',()=>{
 const first={...meeting(),joining_closed_at:new Date(start+1000).toISOString()};assert.equal(joinWindow(first,start+2000).state,'closed');
 assert.equal(joinWindow({...meeting(),status:'cancelled'},start).state,'cancelled');
 const next={...meeting(),id:'next',starts_at:new Date(start+7*86400000).toISOString(),ends_at:new Date(end+7*86400000).toISOString()};
 assert.equal(joinWindow(next,start+7*86400000-1).state,'waiting');assert.equal(joinWindow(next,start+7*86400000).state,'open');
 assert.equal(meetPresentation(meeting(),closes-1).url,url);assert.equal(meetPresentation(meeting(),closes).url,null);
});
test('Actual protected Join handler rejects old saved links at the cutoff and after Admin closure',async()=>{
 let now=start,signed=true,row=meeting();
 const route=load('src/app/dashboard/calendar/api/[id]/join/route.ts',{'../../../join-window':{joinWindow:m=>joinWindow(m,now)},'../../../server':{calendarHeaders:{},calendarAuth:async()=>signed?{client:{},user:{id:'actor'},role:'CEO'}:null,findMeeting:async()=>({data:row,error:null})}});
 const run=()=>route.GET(new Request('http://localhost:3000'),{params:Promise.resolve({id})});
 now=start-1;assert.equal((await run()).status,409);now=start;assert.equal((await run()).status,303);now=closes-1;assert.equal((await run()).status,303);now=closes;assert.equal((await run()).status,410);
 now=start;row={...row,joining_closed_at:new Date(start).toISOString()};assert.equal((await run()).status,410);signed=false;assert.equal((await run()).status,401);
});
const providerModule=load('src/lib/calendar-google/provider.ts',{'server-only':{}});
const {endClaim}=load('src/lib/calendar-google/call-ending.ts',{'server-only':{},'../../app/dashboard/calendar/server':{},'../google-organizer/server':{}});
function fixture(){
 const calls=[],claim={meeting:meeting(),job:{lease:'fixture-lease'}},f={claim,calls,active:'conferenceRecords/current',conflict:false,deny:false,lost:false};
 f.provider={getEvent:async()=>{calls.push('event');return {id:'event',organizer:{email},hangoutLink:url}},getSpace:async()=>{calls.push('space');return {name:'spaces/canonical',meetingUri:url,...(f.active?{activeConference:{conferenceRecord:f.active}}:{})}},getConferenceRecord:async name=>{calls.push('record');return {name,startTime:new Date(start+1000).toISOString()}},endActiveConference:async name=>{assert.equal(name,'spaces/canonical');calls.push('end');if(f.deny)throw new providerModule.GoogleHttpError(403);f.active=null;if(f.lost)throw new providerModule.GoogleHttpError(504)}};
 f.control=async(action,data)=>{calls.push(action);if(action==='assert')return f.conflict?{conflict:true}:{valid:true};if(action==='bind'){claim.job.space_name=data.space;claim.job.conference_record=data.conference;return {valid:true}}if(action==='finish'){f.state=data.state;return {state:data.state}}};
 f.run=()=>endClaim(claim,f.provider,email,f.control,closes);return f;
}
test('Google ending is confirmed only after the observed conference is no longer active',async()=>{
 const f=fixture();assert.equal(await f.run(),'ended');assert.equal(f.calls.filter(c=>c==='end').length,1);assert.equal(f.state,'ended');assert(f.claim.job.conference_record);
});
test('Google permission rejection is unavailable, never a false ended result',async()=>{
 const f=fixture();f.deny=true;assert.equal(await f.run(),'unavailable');assert.equal(f.active,'conferenceRecords/current');assert.equal(f.state,'unavailable');
});
test('No active call is distinct from ending a call; a replaced conference is never terminated by retry',async()=>{
 const f=fixture();f.active=null;assert.equal(await f.run(),'no_active_call');assert(!f.calls.includes('end'));
 const replaced=fixture();replaced.claim.job.conference_record='conferenceRecords/previous';assert.equal(await replaced.run(),'ended');assert(!replaced.calls.includes('end'));assert.equal(replaced.active,'conferenceRecords/current');
});
test('An ambiguous end response retries against the bound conference without ending a replacement',async()=>{
 const f=fixture();f.lost=true;assert.equal(await f.run(),'retry');assert.equal(f.active,null);f.lost=false;assert.equal(await f.run(),'ended');assert.equal(f.calls.filter(c=>c==='end').length,1);
});
test('Shared active occurrence and out-of-window conference identities fail safely',async()=>{
 const f=fixture();f.conflict=true;assert.equal(await f.run(),'shared_space');assert(!f.calls.includes('event'));
 const old=fixture();old.provider.getConferenceRecord=async name=>({name,startTime:new Date(start-1).toISOString()});assert.equal(await old.run(),'unavailable');assert(!old.calls.includes('end'));
});
test('A conference replaced just before POST is not ended',async()=>{
 const f=fixture();let reads=0;const original=f.provider.getSpace;
 f.provider.getSpace=async(...args)=>{reads++;if(reads===2)f.active='conferenceRecords/new';return original(...args)};
 assert.equal(await f.run(),'ended');assert(!f.calls.includes('end'));assert.equal(f.active,'conferenceRecords/new');
});
test('Only Admin may request early end; unavailable Google ending is reported as partial, not success',async()=>{
 let role='CEO',now=start,row=meeting(),requests=0;
 const route=load('src/app/dashboard/calendar/api/[id]/end/route.ts',{'../../../join-window':{joinWindow:m=>joinWindow(m,now)},'../../../server':{calendarHeaders:{},calendarAuth:async()=>({client:{},user:{id:'admin'},role}),findMeeting:async()=>({data:row,error:null}),calendarAdmin:()=>({rpc:async()=>{requests++;row={...row,joining_closed_at:new Date(start).toISOString(),call_end_status:'unavailable'};return {data:{pending:true},error:null}}})},'../../../../../../lib/calendar-google/call-ending':{runCallEnding:async()=>({processed:1,ended:0})}});
 const req=()=>new Request('http://localhost:3000/dashboard/calendar/api/'+id+'/end',{method:'POST',headers:{origin:'http://localhost:3000'}}),ctx={params:Promise.resolve({id})};
 assert.equal((await route.POST(req(),ctx)).status,403);role='Admin';now=start-1;assert.equal((await route.POST(req(),ctx)).status,409);assert.equal(requests,0);
 now=start;const response=await route.POST(req(),ctx);assert.equal(response.status,202);const result=await response.json();assert.match(result.message,/Google call termination is unavailable/);assert(row.joining_closed_at);
});
test('Actual Google end endpoint uses the canonical name, POST and an empty body',async()=>{
 const old=global.fetch;let calls=0;global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://meet.googleapis.com/v2/spaces/canonical:endActiveConference');assert.equal(options.method,'POST');assert.equal(options.body,undefined);return Response.json({})};
 try{await new providerModule.CalendarGoogleProvider(async()=>'fixture',Date.now()+1000).endActiveConference('spaces/canonical');assert.equal(calls,1)}finally{global.fetch=old}
});
test('Durable SQL jobs fence versions, leases, shared spaces and browser execution',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261118100000_meeting_join_windows.sql'),'utf8');
 for(const pattern of [/ends_at\+interval '3 hours'/,/role='admin' and status='active'/,/j.desired_version<>o.version/,/j.lease is distinct from p_lease/,/j.next_attempt_at>clock_timestamp\(\)/,/on conflict\(join_key\) do update/,/calendar_call_end_space_leases.lease_until<clock_timestamp\(\)/,/other.id<>o.id/,/other.starts_at<=v_now/,/revoke all on public.calendar_call_end_jobs from public,anon,authenticated/,/Meeting call-ending check in progress/])assert.match(sql,pattern);
});
