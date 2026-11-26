/* eslint-disable @typescript-eslint/no-require-imports -- Offline tests exercise the actual TypeScript profile gates with mocked Auth/DB clients. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function source(file){return fs.readFileSync(path.join(root,file),'utf8')}
function load(file,mocks={}){const filename=path.join(root,file),js=ts.transpileModule(source(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,mod={exports:{}};vm.runInNewContext(`(function(require,module,exports){${js}\n})`,{console,Date,Intl,URL,FormData,Request,Response,File})(name=>Object.hasOwn(mocks,name)?mocks[name]:name.startsWith('.')?require(path.resolve(path.dirname(filename),name)):require(name),mod,mod.exports);return mod.exports}

test('Active Employee/HOD accounts gain profile access while the dashboard role gate remains executive-only',async()=>{
 const roles={staff:'Employee',hod:'HOD',ceo:'CEO',admin:'Admin',inactive:null},client={from:()=>query};let current='staff';
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{role:current},error:null})};
 const {getActiveAccountRole,getStaffRole}=load('src/lib/staff-auth.ts',{'next/headers':{},'./supabase-client':{}});
 assert.equal(await getActiveAccountRole(client,{id:'u',email:'u@enibrand.com'}),'Employee');current='hod';assert.equal(await getActiveAccountRole(client,{id:'u',email:'u@enibrand.com'}),'HOD');
 for(const [role,label] of Object.entries(roles)){current=role;assert.equal(await getActiveAccountRole(client,{id:'u',email:'u@enibrand.com'}),label)}
 assert.equal(await getActiveAccountRole(client,{id:'u',email:'u@other.com'}),null);
 current='staff';assert.equal(await getStaffRole(client,{id:'u',email:'u@enibrand.com'}),null,'employees cannot pass the protected dashboard gate');
 assert.match(source('src/app/dashboard/access.ts'),/getStaffRole/);
});

test('Staff sign-in sends employees/HODs to profile-only access and executives to the dashboard',async()=>{
 let role='Employee',signedOut=false;const client={auth:{signInWithPassword:async()=>({data:{session:{},user:{id:'fixture',email:'fixture@enibrand.com'}},error:null})}};
 const action=load('src/app/sign-in/actions.ts',{
  'next/navigation':{redirect(url){throw Object.assign(new Error(url),{location:url})}},
  '../../lib/connect-enrollment':{recordConnectSignIn:async()=>{}},
  '../../lib/staff-auth':{createStaffClient:async()=>client,getActiveAccountRole:async()=>role,clearStaffSession:async()=>{signedOut=true}},
 });
 const form=new FormData();form.set('username','fixture');form.set('password','fixture-password');
 await assert.rejects(()=>action.signInStaff(null,form),error=>error.location==='/account/profile');assert.equal(signedOut,false);
 role='CEO';await assert.rejects(()=>action.signInStaff(null,form),error=>error.location==='/dashboard');
 assert.match(source('src/app/dashboard/access.ts'),/getStaffRole/,'profile-only sign-in does not widen dashboard authorization');
});

test('Profile HTTP handlers update only the authenticated account and require same-origin active access',async()=>{
 const id='12345678-1234-4234-8234-123456789abc',writes=[];let allowed=true,origin=true;
 const table=(name)=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:name==='connect_profiles'?{display_name:'Current Name',avatar_url:null}:{name:'Current Name'},error:null})})}),upsert:async(value)=>{writes.push([name,value]);return {error:null}}});
 const admin={from:table};const client={auth:{updateUser:async(value)=>{writes.push(['auth',value]);return {error:null}}}};
 const route=load('src/app/account/profile/api/route.ts',{
  '../../../../lib/account-profile/server':{accountActor:async()=>allowed?{client,user:{id,email:'current@enibrand.com',user_metadata:{}},role:'Employee'}:null,accountHeaders:{'Cache-Control':'private, no-store'},profileAdmin:()=>admin,profilePhotoPath:(user)=>`/account/profile/photo/${user}`,validCompanyEmail:value=>typeof value==='string'&&/^[^@]+@enibrand\.com$/i.test(value.trim()),validDisplayName:value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=120},
  '../../../../lib/staff-access/server':{trustedOrigin:()=>origin},
 });
 const get=await route.GET();assert.equal(get.status,200);assert.equal((await get.json()).email,'current@enibrand.com');
 const post=(body)=>route.POST(new Request('http://localhost:3000/account/profile/api',{method:'POST',headers:{origin:'http://localhost:3000'},body:JSON.stringify(body)}));
 assert.equal((await post({name:'Updated Name',email:'current@enibrand.com'})).status,200);
 assert(writes.every(([,value])=>!value.user_id||value.user_id===id),'the request cannot choose another account');
 assert.equal((await post({name:'Attacker',email:'other@example.com'})).status,400);
 origin=false;assert.equal((await post({name:'Updated Name',email:'current@enibrand.com'})).status,403);
 origin=true;allowed=false;assert.equal((await route.GET()).status,403);assert.equal((await post({name:'Updated Name',email:'current@enibrand.com'})).status,403);
});

test('Uploaded profile photos stay in a private bucket behind authenticated server routes',()=>{
 const migration=source('supabase/migrations/20261122100000_private_profile_photos.sql');
 assert.match(migration,/values \('hub-profile-photos','hub-profile-photos',false/);assert.doesNotMatch(migration,/public\s*=\s*true|create policy/i);
 assert.match(source('src/app/account/profile/photo/route.ts'),/actor\.user\.id\}\/avatar/);
 assert.match(source('src/app/account/profile/photo/[userId]/route.ts'),/accountActor\(\)/);
 assert.match(source('src/lib/account-profile/server.ts'),/Cache-Control/,'photo responses inherit private no-store headers from the shared helper');
});

test('Quote control has no pause affordance and notification sound/vibration are best-effort browser features',()=>{
 assert.doesNotMatch(source('src/app/dashboard/office-quote.tsx'),/Pause quotes|Resume quotes|setPaused/);
 assert.match(source('src/app/dashboard/notifications/notification-chime.tsx'),/linearRampToValueAtTime\(\.48/);
 assert.match(source('src/app/dashboard/notifications/notification-chime.tsx'),/navigator\.vibrate/);
 assert.match(source('src/app/dashboard/page.tsx'),/overview-recognition__people/);
 assert.match(source('src/app/dashboard/page.tsx'),/overview-game-night__actions/);
});
