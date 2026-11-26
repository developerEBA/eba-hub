/* eslint-disable @typescript-eslint/no-require-imports*/
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
function load(file,stubs={}){const f=path.join(root,file),previous=Module._load;delete require.cache[f];try{Module._load=function(name,...args){return Object.hasOwn(stubs,name)?stubs[name]:previous.call(this,name,...args)};return require(f)}finally{Module._load=previous}}
const sql=read('supabase/migrations/20261121120000_announcements.sql');
const people={author:{id:'10000000-0000-4000-8000-000000000001',role:'admin',status:'active',departments:['graphics']},otherAdmin:{id:'10000000-0000-4000-8000-000000000002',role:'ceo',status:'active',departments:['events']},assigned:{id:'10000000-0000-4000-8000-000000000003',role:'hod',status:'active',departments:['graphics']},outsider:{id:'10000000-0000-4000-8000-000000000004',role:'staff',status:'active',departments:['events']}};
function eligible(person,record,now=Date.now()){return ['ceo','admin'].includes(person.role)&&person.status==='active'&&record.status==='published'&&record.published&&(!record.expires||Date.parse(record.expires)>now)&&(record.audience==='company'||record.departments.some((d)=>person.departments.includes(d)));}

test('Fixture authorization checks active roles, audience isolation, CEO/Admin gate, reassignment and deactivation',()=>{
 const rec={status:'published',published:true,audience:'departments',departments:['graphics']};
 assert.equal(eligible(people.author,rec),true);assert.equal(eligible(people.otherAdmin,rec),false);
 assert.equal(eligible({...people.author,departments:['events']},rec),false,'current assignment change revokes');
 assert.equal(eligible({...people.author,status:'inactive'},rec),false,'deactivation revokes');
 assert.equal(eligible(people.author,{...rec,expires:'2000-01-01T00:00:00Z'}),false,'expired revisions are hidden');
 assert.equal(eligible(people.author,{...rec,audience:'company'}),true);
 assert.equal(eligible(people.assigned,rec),false,'Employee/HOD rollout remains unavailable');
});

test('Migration enforces author-only changes, revisioned publication, idempotency, durable acknowledgement and read-time assignment checks',()=>{
 for(const pattern of [
  /m\.status='active'.*?m\.role in \('ceo','admin'\)/s,
  /rec\.author_id<>person/,
  /announcement_recipient_access\(p_id,p_revision\)/,
  /staff_department_assignments d[\s\S]*?d\.department=any\(r\.departments\)/,
  /primary key \(announcement_id,revision,user_id\)/,
  /on conflict do nothing/,
  /unique index announcements_author_request/,
  /pg_advisory_xact_lock\(hashtextextended\(person::text\|\|p_request::text,0\)\)/,
  /rec\.current_revision\+1/,
  /superseded_at=clock_timestamp\(\)/,
  /expires_at>clock_timestamp\(\)/,
  /revoke all on public\.announcements[\s\S]*?from public,anon,authenticated/,
 ])assert.match(sql,pattern);
});

test('Management action validates content and serializes calls through the authenticated RPC',async()=>{
 const calls=[];let access=true;
 const loadedActions=load('src/app/dashboard/announcements/actions.ts',{'../access':{requireDashboardAccess:async()=>{if(!access)throw Error('inactive');return{client:{rpc:async(name,args)=>{calls.push({name,args});return{data:{id:'10000000-0000-4000-8000-000000000009',status:'published'},error:null}}}}}},'next/cache':{revalidatePath:()=>{}}});
 const payload={title:'Update',body:'Message',audience_type:'departments',departments:['graphics'],expires_at:null};
 assert.deepEqual(await loadedActions.manageAnnouncement('create_publish',null,null,payload,'10000000-0000-4000-8000-000000000010'),{result:{id:'10000000-0000-4000-8000-000000000009',status:'published'}});
 assert.equal(calls[0].name,'announcement_manage');assert.equal(calls[0].args.p_action,'create_publish');
 assert.match((await loadedActions.manageAnnouncement('create',null,null,{...payload,title:'x'.repeat(161)},'10000000-0000-4000-8000-000000000010')).error,/Check/);
 assert.equal(calls.length,1,'invalid content never reaches the server RPC');
 access=false;await assert.rejects(()=>loadedActions.manageAnnouncement('archive','10000000-0000-4000-8000-000000000009',1));
});

test('Recipient next endpoint returns only the scoped RPC result and fails closed for inactive sessions',async()=>{
 const value={id:'10000000-0000-4000-8000-000000000009',revision:2,title:'Scoped',body:'Authorized text'};
 const loaded=load('src/app/dashboard/announcements/api/next/route.ts',{'../../../access':{requireHodDashboardAccess:async()=>({client:{rpc:async()=>({data:value,error:null})}})}});
 const response=await loaded.GET();assert.equal(response.status,200);assert.equal((await response.json()).announcement.body,'Authorized text');assert.match(response.headers.get('cache-control'),/no-store/);
 const denied=load('src/app/dashboard/announcements/api/next/route.ts',{'../../../access':{requireHodDashboardAccess:async()=>{throw Error('inactive')}}});
 assert.equal((await denied.GET()).status,401);
});

test('Acknowledgement endpoint checks origin, validates input, and delegates live access and idempotence to the database',async()=>{
 const calls=[];const loaded=load('src/app/dashboard/announcements/api/acknowledge/route.ts',{'../../../access':{requireHodDashboardAccess:async()=>({client:{rpc:async(name,args)=>{calls.push({name,args});return{data:true,error:null}}}})}});
 const request=new Request('https://hub.invalid/dashboard/announcements/api/acknowledge',{method:'POST',headers:{origin:'https://hub.invalid','content-type':'application/json'},body:JSON.stringify({id:'10000000-0000-4000-8000-000000000009',revision:2})});
 assert.equal((await loaded.POST(request)).status,200);assert.equal(calls[0].name,'announcement_acknowledge');assert.equal(calls[0].args.p_revision,2);
 const invalid=new Request('https://hub.invalid/dashboard/announcements/api/acknowledge',{method:'POST',headers:{origin:'https://hub.invalid','content-type':'application/json'},body:JSON.stringify({id:'bad',revision:2})});assert.equal((await loaded.POST(invalid)).status,400);
 const denied=load('src/app/dashboard/announcements/api/acknowledge/route.ts',{'../../../access':{requireHodDashboardAccess:async()=>({client:{rpc:async()=>({data:null,error:{message:'ineligible'}})}})}});
 const deniedReq=new Request('https://hub.invalid/dashboard/announcements/api/acknowledge',{method:'POST',headers:{origin:'https://hub.invalid','content-type':'application/json'},body:JSON.stringify({id:'10000000-0000-4000-8000-000000000009',revision:2})});assert.equal((await denied.POST(deniedReq)).status,409);
});

test('Management navigation and presentation keep active routes, author actions, recipient metadata and accessible responsive controls',()=>{
 const navigation=read('src/app/dashboard/navigation.tsx'),manager=read('src/app/dashboard/announcements/manager.tsx'),prompt=read('src/app/dashboard/announcements/prompt.tsx'),history=read('src/app/dashboard/announcements/history/page.tsx'),css=read('src/app/dashboard/dashboard.css');
 assert.match(navigation,/key: "calendar"[\s\S]*?key: "announcements", label: "Announcements"[\s\S]*?M3 11/);
 assert.match(manager,/const own=item\.author_id===currentUserId/);assert.match(manager,/own&&item\.status==="draft"/);assert.match(manager,/own&&item\.status==="published"/);
 assert.match(manager,/aria-current=\{view===key\?"page":undefined\}/);assert.match(manager,/Search title/);assert.match(manager,/Audience<select/);
 assert.match(manager,/You have unsaved changes/);assert.match(manager,/dialog ref=\{panel\}/);assert.match(manager,/Confirm publish/);
 assert.match(prompt,/From EBA Hub/);assert.match(prompt,/Published \{dateTime\.format/);assert.match(prompt,/Got it/);
 assert.match(history,/section="announcements"/);assert.match(history,/RECIPIENT VIEW/);
 assert.match(css,/--announcement-green:#063c2d/);assert.match(css,/--announcement-yellow:#fde342/);assert.match(css,/\.eba-announcements__panel \{ inset:0; width:100vw/);
});
