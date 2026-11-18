/* eslint-disable @typescript-eslint/no-require-imports -- Run TypeScript with the already installed compiler. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const compileTypeScript = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
require.extensions['.ts'] = compileTypeScript;
require.extensions['.tsx'] = compileTypeScript;
require.extensions['.css'] = () => {};
const base = path.resolve(__dirname,'../src/app/dashboard/calendar');
const model = require(base+'/model.ts');
const admin = '00000000-0000-4000-8000-000000000001', ceo = '00000000-0000-4000-8000-000000000002', outsider = '00000000-0000-4000-8000-000000000003';
const now = new Date('2026-11-16T08:00:00Z');
const input = {title:'Leadership review',agenda:'Agenda',start:'2026-11-18T10:00',end:'2026-11-18T11:00',frequency:'once',attendees:[ceo],departments:[]};
test('Request IDs work when randomUUID is unavailable on a local HTTP context',()=>{
  const id=model.calendarRequestId({getRandomValues(bytes){bytes.fill(7);return bytes}});
  assert.equal(id,'07070707-0707-4707-8707-070707070707');
  assert(model.uuidPattern.test(id));
});
test('Lagos conversion, midnight and invalid calendar dates',()=>{
  assert.equal(model.lagosToISO('2026-11-18T10:00'),'2026-11-18T09:00:00.000Z');
  assert.equal(model.localDateTime('2026-11-17T23:30:00Z'),'2026-11-18T00:30');
  assert.equal(model.lagosDate(new Date('2026-11-17T23:30:00Z')),'2026-11-18');
  for(const value of ['2026-02-30T10:00','2026-11-18T25:00','2026-11-18T10:90','2026-11-18T10:00Z']) assert.throws(()=>model.lagosToISO(value));
});
test('Week views use Monday boundaries in Lagos, including year rollover',()=>{
  assert.equal(model.viewRange('week',now).from,'2026-11-15T23:00:00.000Z');
  assert.equal(model.viewRange('next',now).from,'2026-11-22T23:00:00.000Z');
  assert.equal(model.viewRange('week',new Date('2027-01-01T12:00:00Z')).start,'2026-12-28');
  assert.equal(model.viewRange('upcoming',now).from,now.toISOString());
});
test('One-off and inclusive weekly recurrence keep Lagos times and durations',()=>{
  assert.equal(model.weeklyDates(model.validateInput(input,now)).length,1);
  const dates=model.weeklyDates(model.validateInput({...input,frequency:'weekly',until:'2026-12-02'},now));
  assert.equal(dates.length,3);assert.equal(dates[2].startsAt,'2026-12-02T09:00:00.000Z');
  assert(dates.every(slot=>+new Date(slot.endsAt)-+new Date(slot.startsAt)===3600000));
  assert.equal(model.weeklyDates(model.validateInput({...input,frequency:'weekly',until:model.addDays('2026-11-18',364)},now)).length,53);
});
test('Invalid times, attendees and unbounded recurrence are rejected',()=>{
  for(const change of [{title:''},{end:input.start},{start:'2026-11-15T10:00'},{end:'2026-11-20T11:00'},{attendees:[]},{attendees:['bad']},{departments:['fake']},{departments:['toString']},{frequency:'daily'},{frequency:'weekly',until:null},{frequency:'weekly',until:'2026-11-17'},{frequency:'weekly',until:'2028-01-01'}]) assert.throws(()=>model.validateInput({...input,...change},now));
});
test('Selections deduplicate attendees and accept only known department identifiers',()=>{
  assert.deepEqual(model.validateInput({...input,attendees:[ceo,ceo]},now).attendees,[ceo]);
  assert.deepEqual(model.validateInput({...input,attendees:[],departments:['development']},now).departments,['development']);
});
test('Isolated HTTP contract: executive reads, organizer writes and denied staff-only access',async()=>{
  let actor=admin, stored=null, version=0;
  const otherAdmin='00000000-0000-4000-8000-000000000004';
  const client={},visible=user=>stored&&[admin,ceo,otherAdmin].includes(user);
  const stub={
    calendarHeaders:{'Cache-Control':'private, no-store'},setupMessage:'Setup pending',
    calendarAuth:async()=>actor&&actor!==outsider?{user:{id:actor},client,role:actor===ceo?'CEO':'Admin'}:null,
    loadDirectory:async()=>({ready:true,departments:[],people:[{user_id:admin},{user_id:ceo},{user_id:otherAdmin}]}),
    findMeeting:async(_client,user,id)=>({data:visible(user)&&stored.id===id?structuredClone(stored):null,error:null}),
    loadMeetings:async(_client,user)=>({meetings:visible(user)&&stored.status==='scheduled'?[structuredClone(stored)]:[],ready:true,error:null,truncated:false}),
    calendarAdmin:()=>({rpc:async(_name,args)=>{
      if(args.p_command!=='create'&&args.p_version!==version)return {error:{message:'Meeting changed. Refresh before editing'},data:null};
      if(args.p_command==='cancel')stored.status='cancelled';
      else stored={...(stored??{}),id:'00000000-0000-4000-8000-000000000010',organizer_id:admin,title:args.p_payload.title,starts_at:args.p_payload.startsAt,ends_at:args.p_payload.endsAt,attendee_ids:args.p_payload.attendees,status:'scheduled'};
      stored.version=++version;return {data:stored.id,error:null};
    }}),
  };
  const original=Module._load;let route,detail;
  try{Module._load=function(name,...args){if(name==='../server'||name==='../../server')return stub;return original.call(this,name,...args)};route=require(base+'/api/route.ts');detail=require(base+'/api/[id]/route.ts');}finally{Module._load=original;}
  const request=(body,origin='http://localhost:3000')=>new Request('http://localhost:3000/dashboard/calendar/api',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),scope:'one',...body})});
  const future={...input,attendees:[otherAdmin],start:'2030-11-18T10:00',end:'2030-11-18T11:00'};
  const created=await route.POST(request({command:'create',...future}));assert.equal(created.status,200);const {id}=await created.json();
  const get=()=>detail.GET(new Request('http://localhost:3000'),{params:Promise.resolve({id})});
  actor=ceo;assert.equal((await get()).status,200);assert.equal((await route.POST(request({command:'cancel',id,version}))).status,404);
  actor=outsider;assert.equal((await get()).status,401);assert.equal((await route.POST(request({command:'update',id,version,...future}))).status,401);
  actor=admin;assert.equal((await route.POST(request({command:'update',id,version,...future,title:'Rescheduled',start:'2030-11-19T12:00',end:'2030-11-19T13:00'}))).status,200);
  for(const user of [admin,ceo]){actor=user;assert.equal((await (await get()).json()).title,'Rescheduled');}
  actor=admin;assert.equal((await route.POST(request({command:'update',id,version:1,...future}))).status,409);assert.equal((await route.POST(request({command:'cancel',id,version}))).status,200);
  for(const user of [admin,ceo]){actor=user;assert.deepEqual((await (await route.GET(new Request('http://localhost:3000/dashboard/calendar/api?view=upcoming'))).json()).meetings,[]);}
  assert.equal((await route.POST(request({command:'create',...future},'http://untrusted.example'))).status,403);
  actor=null;assert.equal((await get()).status,401);
});

test('Calendar and meeting details stay Meet setup pending; Overview uses the same occurrence',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const original=Module._load;let CalendarClient,MeetingDialog,UpcomingMeetings;
  try {
    Module._load=function(name,...args){
      if(name.endsWith('use-meeting-clock'))return {useMeetingClock:()=>Date.parse(model.viewRange('week').from)};
      if(name==='next/navigation')return {useRouter:()=>({refresh(){}})};
      if(name==='next/link')return {__esModule:true,default:({children,href})=>React.createElement('a',{href},children)};
      if(name.includes('google-organizer'))throw Error('Calendar must not depend on organizer connection status');
      return original.call(this,name,...args);
    };
    ({CalendarClient}=require(base+'/calendar-client.tsx'));
    ({MeetingDialog}=require(base+'/meeting-dialog.tsx'));
    ({UpcomingMeetings}=require(base+'/upcoming-meetings.tsx'));
  } finally {Module._load=original;}
  const start=model.viewRange('week').start;
  const meeting={id:'00000000-0000-4000-8000-000000000010',series_id:'00000000-0000-4000-8000-000000000011',organizer_id:admin,
    title:'Calendar regression meeting',agenda:'Review',starts_at:model.lagosToISO(start+'T10:00'),ends_at:model.lagosToISO(start+'T11:00'),
    frequency:'weekly',recurrence_until:model.addDays(start,21),attendee_ids:[ceo],department_targets:[],status:'scheduled',version:1,ordinal:0,
    timezone:'Africa/Lagos',original_starts_at:model.lagosToISO(start+'T10:00')};
  const directory={ready:true,departments:[],people:[{user_id:admin,display_name:'Admin fixture',role:'admin',departments:[]},{user_id:ceo,display_name:'CEO fixture',role:'ceo',departments:[]}]};
  const initial={meetings:[meeting],ready:true,error:null,truncated:false};
  const calendar=renderToStaticMarkup(React.createElement(CalendarClient,{userId:admin,initial,directory}));
  for(const label of ['This Week','Next Week','Upcoming','Africa/Lagos','Meet setup pending'])assert(calendar.includes(label));
  assert(calendar.includes(`data-meeting-id="${meeting.id}"`));assert(!calendar.includes('Join Google Meet'));
  const details=renderToStaticMarkup(React.createElement(MeetingDialog,{meeting,userId:ceo,directory,onClose(){},onSaved(){}}));
  assert(details.includes('Meet setup pending'));assert(details.includes('Only the organizer can edit or cancel this meeting.'));
  assert(!details.includes('>Edit meeting</button>'));assert(!details.includes('>Cancel meeting</button>'));
  const create=renderToStaticMarkup(React.createElement(MeetingDialog,{meeting:null,userId:admin,directory,onClose(){},onSaved(){}}));
  assert(create.includes('Meet setup pending'));assert(create.includes('Schedule meeting'));
  const overview=renderToStaticMarkup(React.createElement(UpcomingMeetings,{initial}));
  assert(overview.includes(`/dashboard/calendar?meeting=${meeting.id}`));assert(overview.includes(meeting.title));assert(overview.includes('Africa/Lagos'));assert(!overview.includes('Join Google Meet'));
});
