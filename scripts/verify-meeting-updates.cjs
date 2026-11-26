/* eslint-disable @typescript-eslint/no-require-imports*/
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
function load(file,stubs={}){const filename=path.join(root,file);delete require.cache[filename];const old=Module._load;try{Module._load=function(name,...args){return Object.hasOwn(stubs,name)?stubs[name]:old.call(this,name,...args)};return require(filename)}finally{Module._load=old}}
const model=require('../src/app/dashboard/calendar/model.ts');
test('Today includes the whole Lagos day, not just future meetings',()=>{
 const range=model.viewRange('today',new Date('2030-11-20T16:00:00+01:00'));
 assert.equal(range.from,'2030-11-19T23:00:00.000Z');assert.equal(range.to,'2030-11-20T23:00:00.000Z');
 const midnight=model.viewRange('today',new Date('2030-11-20T23:30:00Z'));assert.equal(midnight.start,'2030-11-21');
});
test('Actual meeting queries include every meeting for CEO/Admin while unspecified roles stay participant-scoped',async()=>{
 const server=load('src/app/dashboard/calendar/server.ts',{'server-only':{},'../../../lib/staff-auth':{}});
 const filters=[];let missing=false,columns;
 const query={select(c){columns=c;return this},or(filter){filters.push(filter);return this},eq(){return this},gt(){return this},lt(){return this},order(){return this},limit(){return this},overrideTypes:async()=>({data:[],error:missing&&columns.includes(',audience')?{code:'42703',message:'audience missing'}:null})};
 const client={from:()=>query};
 await server.loadMeetings(client,'fixture','today',200,'CEO');assert.equal(filters.length,0);
 await server.loadMeetings(client,'fixture','today',200,'Admin');assert.equal(filters.length,0);
 missing=true;await server.loadMeetings(client,'fixture','today',200,'CEO');assert.equal(filters.length,0);
 await server.loadMeetings(client,'fixture','today',200);assert.match(filters.at(-1),/organizer_id.eq.fixture,attendee_ids/);
});
test('Company visibility SQL preserves private invitations and does not enable HOD/Employee access',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261117151000_calendar_company_visibility.sql'),'utf8');
 assert.match(sql,/default 'private'/);assert.match(sql,/audience<>'private'.*m.role='ceo'/s);assert.match(sql,/o.organizer_id<>p_actor/);
 assert.match(sql,/o.audience_version<>p_version/);assert(!/alter table public.staff_memberships/.test(sql));
});
const email='admin@enibrand.com',url='https://meet.google.com/abc-defg-hij';
const event=()=>({id:'google-event',etag:'etag-1',organizer:{email},summary:'Company meeting',start:{dateTime:'2030-11-20T11:00:00Z'},end:{dateTime:'2030-11-20T12:00:00Z'}});
const {prepareImportedMeeting}=require('../src/lib/calendar-google/import-preparation.ts');
function provider(){const calls=[];return {calls,patchEvent:async(id,etag,body)=>{calls.push({kind:'patch',id,etag,body});return {...event(),hangoutLink:url}},getSpace:async()=>{calls.push({kind:'space'});return {name:'spaces/fixture',meetingUri:url,config:{}}},configureRecording:async(name)=>{calls.push({kind:'recording'});return {name,config:{artifactConfig:{recordingConfig:{autoRecordingGeneration:'ON'}}}}}}}
test('Imported preparation patches only conference data with a stable request, then confirms recording',async()=>{
 const p=provider(),now=Date.parse('2030-11-20T10:00:00Z');const result=await prepareImportedMeeting(p,event(),email,now);
 assert.equal(result.recording_status,'configured');assert.deepEqual(Object.keys(p.calls[0].body),['conferenceData']);assert.equal(p.calls[0].etag,'etag-1');
 const second=provider();await prepareImportedMeeting(second,event(),email,now);assert.equal(p.calls[0].body.conferenceData.createRequest.requestId,second.calls[0].body.conferenceData.createRequest.requestId);
 assert.deepEqual(p.calls.map(c=>c.kind),['patch','space','recording']);
});
test('Pending conferences are not recreated; recording failures keep the usable link and warn',async()=>{
 const now=Date.parse('2030-11-20T10:00:00Z'),p=provider();
 const pending=await prepareImportedMeeting(p,{...event(),conferenceData:{createRequest:{status:{statusCode:'pending'}}}},email,now);
 assert.equal(pending.recording_status,'pending');assert.equal(p.calls.length,0);
 p.configureRecording=async()=>({name:'spaces/fixture',config:{artifactConfig:{recordingConfig:{autoRecordingGeneration:'OFF'}}}});
 const warning=await prepareImportedMeeting(p,{...event(),hangoutLink:url},email,now);assert.equal(warning.recording_status,'warning');assert.equal(warning.event.hangoutLink,url);
});
test('Foreign, native EBA, expired and other-provider meetings are not modified',async()=>{
 for(const item of [{...event(),organizer:{email:'other@example.com'}},{...event(),extendedProperties:{private:{ebaOccurrence:'native'}}},{...event(),end:{dateTime:'2020-11-20T12:00:00Z'}},{...event(),conferenceData:{conferenceSolution:{key:{type:'other'}}}}]){
 const p=provider();await prepareImportedMeeting(p,item,email,Date.parse('2030-11-20T10:00:00Z'));assert.equal(p.calls.length,0);
 }
});
test('Recording recheck fairness is not reset by ordinary list scans',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261117152000_imported_meeting_preparation.sql'),'utf8');
 assert.match(sql,/elsif e \? 'recording_status' then update/);assert.match(sql,/recording_status=e->>'recording_status',import_checked_at=clock_timestamp\(\)/);
});
test('Game invitations produce a private deduplicated bell row without public chat posts',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261117150000_game_invitation_notifications.sql'),'utf8');
 assert.match(sql,/after insert on public.game_invites/);assert.match(sql,/values\(new.user_id,new.room_id\)/);assert.match(sql,/on conflict\(recipient_id,game_room_id\).*do nothing/);
 assert.match(sql,/i.user_id=\(select auth.uid\(\)\)/);assert(!/insert into public.connect_messages/.test(sql));
});
test('Notification chime is louder and plays only for new unread IDs after user interaction',async()=>{
 const effects=[],listeners=new Map(),storage=new Map(),tones=[];
 class Audio {constructor(){this.state='suspended';this.currentTime=0;this.destination={}}resume(){this.state='running';return Promise.resolve()}createOscillator(){tones.push('tone');return {frequency:{},connect(){},start(){},stop(){},disconnect(){}}}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(value){assert.equal(value,.48)},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}}}
 const globals={document:global.document,AudioContext:global.AudioContext,sessionStorage:global.sessionStorage};
 global.document={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener(){}};global.AudioContext=Audio;global.sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 try{const {NotificationChime}=load('src/app/dashboard/notifications/notification-chime.tsx',{react:{useEffect:fn=>effects.push(fn)}});
 const render=id=>{effects.length=0;NotificationChime({latestUnreadId:id});effects[1]()};
 NotificationChime({latestUnreadId:0});effects[0]();effects[1]();assert.equal(tones.length,0);
 listeners.get('pointerdown')();await Promise.resolve();render(10);assert.equal(tones.length,4);render(10);render(0);assert.equal(tones.length,4);render(11);assert.equal(tones.length,8);
 }finally{Object.assign(global,globals)}
});
test('Overview renders all today records and missing imported Meet links are labelled honestly',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {UpcomingMeetings}=load('src/app/dashboard/calendar/upcoming-meetings.tsx',{'next/link':({children})=>React.createElement('a',null,children),'./meet-status':{MeetStatus:()=>null}});
 const meetings=Array.from({length:5},(_,i)=>({...event(),id:String(i),title:'Today meeting '+i,starts_at:'2030-11-20T11:00:00Z'}));
 const html=renderToStaticMarkup(React.createElement(UpcomingMeetings,{initial:{ready:true,meetings}}));for(let i=0;i<2;i++)assert(html.includes('Today meeting '+i));for(let i=2;i<5;i++)assert(!html.includes('Today meeting '+i));
 const {meetPresentation}=require('../src/app/dashboard/calendar/meet-model.ts');assert.equal(meetPresentation({source:'google',status:'scheduled',sync_status:'synced',starts_at:'2030-11-20T11:00:00Z',ends_at:'2030-11-20T12:00:00Z'},Date.parse('2030-11-20T11:00:00Z')).label,'No Meet link in Google');
});
test('Audience endpoint denies a company-viewing CEO and saves only the organizer with a version',async()=>{
 let actor='ceo',writes=0;const id='12345678-1234-4234-8234-123456789abc';
 const server={calendarHeaders:{},calendarAuth:async()=>({client:{},user:{id:actor},role:actor==='ceo'?'CEO':'Admin'}),findMeeting:async()=>({data:{organizer_id:'admin'},error:null}),calendarAdmin:()=>({rpc:async(name,args)=>{writes++;assert.equal(name,'calendar_set_audience');assert.equal(args.p_actor,'admin');assert.equal(args.p_version,1);return {error:null}}})};
 const route=load('src/app/dashboard/calendar/api/[id]/audience/route.ts',{'../../../server':server});
 const request=()=>new Request('http://localhost:3000/dashboard/calendar/api/'+id+'/audience',{method:'POST',headers:{origin:'http://localhost:3000'},body:JSON.stringify({audience:'company',version:1})});
 const context={params:Promise.resolve({id})};assert.equal((await route.POST(request(),context)).status,404);assert.equal(writes,0);
 actor='admin';assert.equal((await route.POST(request(),context)).status,200);assert.equal(writes,1);
});
test('Actual bell renders private game invitation link and mark-read controls',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const room='12345678-1234-4234-8234-123456789abc';const query={select(){return this},order(){return this},limit(){return this},overrideTypes:async()=>({data:[{id:50,game_room_id:room,read_at:null,created_at:'2030-11-20T11:00:00Z'}],error:null}),is:async()=>({count:1,error:null})};
 const {NotificationBell}=load('src/app/dashboard/notifications/bell.tsx',{'next/link':({href,children})=>React.createElement('a',{href:typeof href==='string'?href:href.pathname},children),'../../../lib/staff-auth':{createStaffClient:async()=>({from:()=>query})},'../navigation':{DashboardIcon:()=>null},'./controls':{NotificationUpdates:()=>null,MarkRead:({label})=>React.createElement('button',null,label)}});
 const html=renderToStaticMarkup(await NotificationBell({role:'Admin'}));assert.match(html,/invited to a game/);assert(html.includes('/dashboard/games?room='+room));assert.match(html,/Mark read/);assert(!html.includes('New direct message'));
});
test('Overview avatar enrichment reads only participants of already authorized meetings',async()=>{
 const server=load('src/app/dashboard/calendar/server.ts',{'server-only':{},'../../../lib/staff-auth':{}});
 let queried=false;
 const query={select(columns){assert.equal(columns,'user_id,display_name,avatar_url');return this},in(column,ids){assert.equal(column,'user_id');assert.deepEqual(ids,['organizer','invitee']);queried=true;return this},limit(value){assert.equal(value,100);return this},abortSignal(){return this},overrideTypes:async()=>({data:[{user_id:'invitee',display_name:'Fixture participant',avatar_url:null}],error:null})};
 const client={from:table=>{assert.equal(table,'connect_profiles');return query}};
 assert.deepEqual(await server.loadMeetingPeople(client,[]),[]);assert.equal(queried,false);
 const result=await server.loadMeetingPeople(client,[{organizer_id:'organizer',attendee_ids:['invitee','organizer']}]);assert.equal(queried,true);assert.equal(result.length,1);
});
test('Recording confirmation reads Google ON/OFF without changing Google and requires successful persistence',async()=>{
 const oldEmail=process.env.GOOGLE_ORGANIZER_EMAIL;process.env.GOOGLE_ORGANIZER_EMAIL=email;
 let setting='ON',saved=true,owner=email;const calls=[];
 const query={select(){return this},eq(){return this},abortSignal(){return this},maybeSingle:async()=>({data:{provider_calendar_id:email,provider_event_id:'event',join_url:url,version:1,status:'scheduled'},error:null})};
 class Provider{async getEvent(){calls.push('getEvent');return {...event(),organizer:{email:owner},hangoutLink:url}}async getSpace(){calls.push('getSpace');return {name:'spaces/check',meetingUri:url,config:{artifactConfig:{recordingConfig:{autoRecordingGeneration:setting}}}}}async patchEvent(){throw Error('Must not change Google')}async configureRecording(){throw Error('Must not enable recording')}}
 const db={from:()=>query,rpc:(name,args)=>{assert.equal(name,'calendar_confirm_recording');assert.equal(args.p_enabled,setting==='ON');assert.equal(args.p_connection_version,7);calls.push('save');return {abortSignal:async()=>({data:saved,error:null})}}};
 const {confirmRecordingSetting}=load('src/lib/calendar-google/recording-confirmation.ts',{'server-only':{},'../../app/dashboard/calendar/server':{calendarAdmin:()=>db},'../google-organizer/server':{organizerAccess:async()=>({accessToken:'fixture',version:7})},'./provider':{CalendarGoogleProvider:Provider}});
 const meeting={id:'fixture',version:1,status:'scheduled',join_url:url};
 try{
  const on=await confirmRecordingSetting(meeting,'actor');assert.equal(on.automaticEnabled,true);assert.match(on.message,/confirmed ON/);assert.deepEqual(calls,['getEvent','getSpace','save']);
  setting='OFF';assert.equal((await confirmRecordingSetting(meeting,'actor')).automaticEnabled,false);
  setting='UNKNOWN';calls.length=0;await assert.rejects(()=>confirmRecordingSetting(meeting,'actor'));assert(!calls.includes('save'));
  setting='ON';saved=false;await assert.rejects(()=>confirmRecordingSetting(meeting,'actor'));
  saved=true;owner='foreign@example.com';calls.length=0;await assert.rejects(()=>confirmRecordingSetting(meeting,'actor'));assert.deepEqual(calls,['getEvent']);
 }finally{if(oldEmail===undefined)delete process.env.GOOGLE_ORGANIZER_EMAIL;else process.env.GOOGLE_ORGANIZER_EMAIL=oldEmail}
});
test('Recording check endpoint denies outsiders, signed-out, cancelled and cross-origin requests',async()=>{
 let signed=true,visible=false,status='scheduled',checks=0;const id='12345678-1234-4234-8234-123456789abc';
 const route=load('src/app/dashboard/calendar/api/[id]/recording/route.ts',{'../../../server':{calendarHeaders:{},calendarAuth:async()=>signed?{client:{},user:{id:'actor'},role:'Admin'}:null,findMeeting:async()=>({data:visible?{id,status,join_url:url}:null,error:null})},'../../../../../../lib/calendar-google/recording-confirmation':{confirmRecordingSetting:async()=>{checks++;return {automaticEnabled:true}}}});
 const req=(origin='http://localhost:3000')=>new Request('http://localhost:3000/dashboard/calendar/api/'+id+'/recording',{method:'POST',headers:{origin}}),context={params:Promise.resolve({id})};
 assert.equal((await route.POST(req('https://foreign.invalid'),context)).status,403);assert.equal((await route.POST(req(),context)).status,404);
 signed=false;assert.equal((await route.POST(req(),context)).status,401);signed=true;visible=true;status='cancelled';assert.equal((await route.POST(req(),context)).status,409);assert.equal(checks,0);
 status='scheduled';assert.equal((await route.POST(req(),context)).status,200);assert.equal(checks,1);
});
test('Confirmation SQL rechecks permission, current link/version and connection generation without browser write access',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261117160000_recording_setting_confirmation.sql'),'utf8');
 for(const pattern of [/calendar_reminder_account_active\(p_actor\)/,/version=p_connection_version/,/o.version is distinct from p_version/,/o.join_url is distinct from p_url/,/o.organizer_id=p_actor or p_actor=any\(o.attendee_ids\)/,/o.audience<>'private'/,/from public,anon,authenticated/])assert.match(sql,pattern);
 assert(!/insert into public.calendar_occurrences/.test(sql));
});
test('Executive access migration covers all audiences without enabling other roles or meeting writes',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261117163000_executive_meeting_access.sql'),'utf8');
 assert.match(sql,/for select to authenticated\s+using\(\(select public.calendar_access\(\)\)\)/);
 assert(!/audience<>'private'/.test(sql));assert(!/create policy.*for (?:all|update|insert)/i.test(sql));
 assert.match(sql,/calendar_reminder_account_active\(p_actor\)/);assert.match(sql,/version=p_connection_version/);assert.match(sql,/o.join_url is distinct from p_url/);
 assert(!/update public.staff_memberships|insert into public.calendar_occurrences|update public.calendar_occurrences set audience/i.test(sql));
 const initial=fs.readFileSync(path.join(root,'supabase/migrations/20261116115940_calendar_part1.sql'),'utf8');
 assert.match(initial,/role in \('ceo','admin'\)/);assert.match(initial,/status='active'/);
});
