/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real TS modules without installing a test runner. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
require.extensions['.ts'] = (module, filename) => {
  const source=fs.readFileSync(filename,'utf8').replaceAll('import.meta.url','require("node:url").pathToFileURL(__filename).href');
  module._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
};
// These are fake fixture values, never loaded from .env.local.
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
process.env.GOOGLE_CLIENT_ID='fixture-client';process.env.GOOGLE_CLIENT_SECRET='fixture-secret';
process.env.GOOGLE_REDIRECT_URI='http://localhost:3000/api/google/callback';process.env.GOOGLE_ORGANIZER_EMAIL='organizer@example.com';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SECRET_KEY='fixture-server';
let actor={id:'admin',session:'session-a',role:'Admin'}, row, states, cookie, identity, tokens, refreshError, failSave, revokeOK, meet, refreshHook, rpcCalls, providerCalls, scopesOK, identityError;
const jar={get:()=>cookie?{value:cookie}:undefined,set:(_name,value)=>{cookie=value}};
const base=()=>({version:0,email:null,subject:null,refresh_ciphertext:null,enabled:false,status:'disconnected',meet_supported:null,verified_at:null,revocation_failed:false});
function reset(){actor={id:'admin',session:'session-a',role:'Admin'};row=base();states=new Map();cookie='';identity=null;tokens=null;refreshError=null;failSave=false;revokeOK=true;meet=true;refreshHook=null;rpcCalls=[];providerCalls=0;scopesOK=true;identityError=false;}
const database={
  rpc:async(_name,{p_action:a,p_admin:id,p_session:session,p_data:d})=>{
    rpcCalls.push(a);
    if(actor?.role!=='Admin'||actor.id!==id||actor.session!==session)return {error:true};
    if(a==='start'){row.version++;states.set(d.state_hash,{...d,state_hash:d.state_hash,organizer_email:d.email,verifier_ciphertext:d.verifier,admin_id:id,session_id:session,version:row.version,expires:Date.now()+600000,consumed:false});return {data:{}};}
    if(a==='consume'){const s=states.get(d.state_hash);if(!s||s.consumed||s.expires<Date.now()||s.admin_id!==id||s.session_id!==session||s.browser_hash!==d.browser_hash||s.version!==row.version)return {error:true};s.consumed=true;return {data:structuredClone(s)};}
    if(a==='save'){const s=states.get(d.state_hash);if(failSave||!s||!s.consumed||s.saved||s.version!==row.version)return {error:true};s.saved=true;Object.assign(row,{version:row.version+1,email:d.email,subject:d.subject,refresh_ciphertext:d.ciphertext,enabled:true,status:'connected',meet_supported:d.meet_supported,verified_at:new Date().toISOString()});return {data:{}};}
    if(a==='disconnect'){const old=structuredClone(row);Object.assign(row,{version:row.version+1,refresh_ciphertext:null,enabled:false,status:'disconnected',meet_supported:null,revocation_failed:false});states.clear();return {data:old};}
    throw new Error('Unexpected RPC');
  },
  from:()=>{let mutation=null,filters=[];const q={select:()=>q,update:v=>{mutation=v;return q},eq:(k,v)=>{filters.push([k,v]);return q},single:async()=>{
    if(!filters.every(([k,v])=>k==='singleton'||row[k]===v))return {error:true};if(mutation)Object.assign(row,mutation);return {data:structuredClone(row)};
  },then:(resolve,reject)=>q.single().then(resolve,reject)};return q;},
};
const staffClient={auth:{getUser:async()=>({data:{user:actor?{id:actor.id,email:'admin@enibrand.com'}:null}}),getClaims:async()=>({data:{claims:{sub:actor?.id,session_id:actor?.session}}})}};
const providerStub={
  callEndingScope:'https://www.googleapis.com/auth/meetings.space.created',
  googleScopes:['openid','email','https://www.googleapis.com/auth/calendar.events.owned','https://www.googleapis.com/auth/calendar.calendars.readonly','https://www.googleapis.com/auth/meetings.space.settings'],
  libraryReady:()=>true,scopesGranted:()=>scopesOK,isRevoked:e=>e?.response?.data?.error==='invalid_grant',
  ProviderFailure:class extends Error{constructor(kind){super(kind);this.kind=kind}},
  googleClient:()=>({getToken:async({codeVerifier})=>{providerCalls++;assert.equal(typeof codeVerifier,'string');return {tokens:tokens??{id_token:'fixture-id',access_token:'fixture-access',refresh_token:'fixture-refresh',scope:'all'}}},
    verifyIdToken:async({audience})=>{assert.equal(audience,'fixture-client');if(identityError)throw Error('Mock library rejected signature/audience/expiry');return {getPayload:()=>identity??{sub:'subject',email:'organizer@example.com',email_verified:true,nonce:[...states.values()].at(-1).nonce}}},
    getTokenInfo:async()=>({aud:'fixture-client',scopes:providerStub.googleScopes}),
    setCredentials:()=>{},refreshAccessToken:async()=>{if(refreshHook)await refreshHook();if(refreshError)throw refreshError;return {credentials:{access_token:'fixture-refreshed'}}}}),
  calendarSupportsMeet:async()=>meet,revokeToken:async()=>{assert.equal(row.enabled,false);assert.equal(row.refresh_ciphertext,null);return revokeOK},
};
const original=Module._load;
Module._load=function(name,...args){
  if(name==='server-only')return {};
  if(name==='next/headers')return {cookies:async()=>jar};
  if(name==='@supabase/supabase-js')return {createClient:()=>database};
  if(name==='../staff-auth')return {createStaffClient:async()=>staffClient,getStaffRole:async()=>actor?.role??null};
  if(name==='./provider'&&args[0]?.filename?.endsWith(path.join('google-organizer','server.ts')))return providerStub;
  return original.call(this,name,...args);
};
const crypto=require(root+'/src/lib/google-organizer/crypto.ts');
const server=require(root+'/src/lib/google-organizer/server.ts');
const provider=require(root+'/src/lib/google-organizer/provider.ts');
const connect=require(root+'/src/app/api/google/connect/route.ts');
const callback=require(root+'/src/app/api/google/callback/route.ts');
const disconnect=require(root+'/src/app/api/google/disconnect/route.ts');
const status=require(root+'/src/app/api/google/status/route.ts');
Module._load=original;
const post=(origin='http://localhost:3000')=>new Request('http://localhost:3000/api/google/connect',{method:'POST',headers:{origin}});
async function start(){const url=new URL(await server.beginAuthorization(actor));return {url,state:url.searchParams.get('state'),browser:cookie};}
async function finish(flow,extras={}){cookie=flow.browser;return server.finishAuthorization(actor,new URLSearchParams({state:flow.state,code:'fixture-code',...extras}));}
test('AES-GCM ciphertext is randomized and rejects tampering, wrong purpose and wrong key',()=>{
  const a=crypto.encrypt('fixture-refresh','purpose'),b=crypto.encrypt('fixture-refresh','purpose');assert.notEqual(a,b);assert(!a.includes('fixture-refresh'));assert.equal(crypto.decrypt(a,'purpose'),'fixture-refresh');
  assert.throws(()=>crypto.decrypt(a,'other'));assert.throws(()=>crypto.decrypt(a.slice(0,-3)+'abc','purpose'));
  const key=process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;process.env.GOOGLE_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,8).toString('base64');assert.throws(()=>crypto.decrypt(a,'purpose'));process.env.GOOGLE_TOKEN_ENCRYPTION_KEY=key;
});
test('Exact least-privilege scopes and Google email-scope alias',()=>{
  assert.deepEqual(provider.googleScopes,providerStub.googleScopes);assert(provider.scopesGranted(provider.googleScopes.join(' ')));assert(!provider.scopesGranted('openid email'));
  assert(provider.scopesGranted(provider.googleScopes.join(' ').replace(' email ',' https://www.googleapis.com/auth/userinfo.email ')));
});
test('Authorization URL uses PKCE S256, offline access, consent and nonce without secret',async()=>{
  reset();const {url,state}=await start(),s=states.get(crypto.hash(state));assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('code_challenge'),crypto.hash(crypto.decrypt(s.verifier_ciphertext,`pkce:${s.state_hash}`)));assert.equal(url.searchParams.get('nonce'),s.nonce);assert(!url.toString().includes('fixture-secret'));assert(!url.searchParams.has('login_hint'));assert(!url.searchParams.has('hd'));
});
test('Successful callback verifies identity then encrypts and stores before reporting connected',async()=>{
  reset();const f=await start();await finish(f);assert(row.enabled);assert.equal(row.status,'connected');assert.equal(crypto.decrypt(row.refresh_ciphertext,'refresh:organizer@example.com:subject'),'fixture-refresh');
  const result=await server.connectionStatus(true);assert.equal(result.state,'connected');assert.equal(result.meetSupported,true);assert(!JSON.stringify(result).includes('ciphertext'));assert(!JSON.stringify(result).includes('fixture-refresh'));
  await assert.rejects(()=>finish(f),e=>e.notice==='expired');
});

test('Call-ending consent is opt-in and missing optional permission preserves base authorization',async()=>{
  const previous=process.env.GOOGLE_MEET_CALL_ENDING_ENABLED;
  try{
    reset();delete process.env.GOOGLE_MEET_CALL_ENDING_ENABLED;
    let flow=await start();assert(!flow.url.searchParams.get('scope').includes(providerStub.callEndingScope));
    process.env.GOOGLE_MEET_CALL_ENDING_ENABLED='true';flow=await start();
    assert(flow.url.searchParams.get('scope').split(' ').includes(providerStub.callEndingScope));
    await finish(flow);assert(row.enabled);
    assert.equal((await server.organizerAccess()).callEndingAuthorized,false);
    providerStub.googleScopes.push(providerStub.callEndingScope);
    try{assert.equal((await server.organizerAccess()).callEndingAuthorized,true)}
    finally{providerStub.googleScopes.pop()}
  }finally{if(previous===undefined)delete process.env.GOOGLE_MEET_CALL_ENDING_ENABLED;else process.env.GOOGLE_MEET_CALL_ENDING_ENABLED=previous}
});
test('Wrong browser, changed session, expired, superseded, and replayed states are rejected',async()=>{
  for(const kind of ['browser','session','expired','superseded']){reset();const f=await start();if(kind==='browser')f.browser='wrong';if(kind==='session')actor.session='session-b';if(kind==='expired')states.get(crypto.hash(f.state)).expires=0;if(kind==='superseded')await start();await assert.rejects(()=>finish(f),e=>e.notice==='expired');assert.equal(providerCalls,0);assert(!row.enabled);}
});
test('Denial consumes state without token exchange',async()=>{reset();const f=await start();await assert.rejects(()=>finish(f,{error:'access_denied'}),e=>e.notice==='denied');await assert.rejects(()=>finish(f),e=>e.notice==='expired');assert.equal(providerCalls,0)});
test('Unverified, wrong-case, other email and nonce mismatch never persist credentials',async()=>{
  for(const change of [{email:'other@example.com'},{email:'Organizer@example.com'},{email_verified:false},{nonce:'wrong'}]){reset();const f=await start();identity={sub:'subject',email:'organizer@example.com',email_verified:true,nonce:[...states.values()][0].nonce,...change};await assert.rejects(()=>finish(f),e=>e.notice==='mismatch');assert(!row.enabled);assert.equal(row.refresh_ciphertext,null);}
});
test('Missing offline token cannot connect, while reconnect preserves an existing refresh token',async()=>{
  reset();let f=await start();tokens={id_token:'fixture-id',access_token:'fixture-access',scope:'all'};await assert.rejects(()=>finish(f),e=>e.notice==='refresh_missing');assert(!row.enabled);
  tokens=null;f=await start();await finish(f);const old=row.refresh_ciphertext;tokens={id_token:'fixture-id',access_token:'fixture-access',scope:'all'};f=await start();await finish(f);assert(row.enabled);assert.notEqual(row.refresh_ciphertext,old);assert.equal(crypto.decrypt(row.refresh_ciphertext,'refresh:organizer@example.com:subject'),'fixture-refresh');
});
test('Storage failure never reports connected; unsupported conferencing is reported honestly',async()=>{
  reset();let f=await start();failSave=true;await assert.rejects(()=>finish(f));assert(!row.enabled);
  reset();f=await start();meet=false;await finish(f);assert.equal((await server.connectionStatus(true)).meetSupported,false);
});
test('Revoked offline access disables credentials and status requires reconnect',async()=>{
  reset();const f=await start();await finish(f);refreshError={response:{data:{error:'invalid_grant'}}};assert.equal((await server.connectionStatus(true)).state,'revoked');assert(!row.enabled);assert.equal(row.refresh_ciphertext,null);
});
test('Disconnect disables locally before revocation and invalidates pending authorization',async()=>{
  reset();let f=await start();await finish(f);f=await start();revokeOK=false;assert.equal(await server.disconnectOrganizer(actor),'revocation_failed');assert(!row.enabled);assert(row.revocation_failed);await assert.rejects(()=>finish(f));
  reset();f=await start();await finish(f);assert.equal(await server.disconnectOrganizer(actor),'disconnected');assert(!row.enabled);
});
test('Disconnect during refresh prevents use of the refreshed access token',async()=>{
  reset();const f=await start();await finish(f);refreshHook=async()=>{await server.disconnectOrganizer(actor)};await assert.rejects(()=>server.organizerAccess(),e=>e.notice==='expired');assert(!row.enabled);
});
test('HTTP routes deny CEOs, signed-out requests and cross-origin mutations',async()=>{
  reset();actor.role='CEO';assert.equal((await connect.POST(post())).status,403);assert.equal((await disconnect.POST(post())).status,403);assert.equal((await status.GET()).status,200);
  const result=await callback.GET(new Request('http://localhost:3000/api/google/callback?state=fixture&code=fixture'));assert(result.headers.get('location').endsWith('google=forbidden'));assert.equal(rpcCalls.length,0);
  actor=null;assert.equal((await status.GET()).status,403);assert.equal((await connect.POST(post())).status,403);
  reset();assert.equal((await connect.POST(post('https://attacker.invalid'))).status,403);assert.equal((await disconnect.POST(post('https://attacker.invalid'))).status,403);assert.equal(rpcCalls.length,0);
});
test('Callback redirects contain only allowlisted notices, never provider payloads',async()=>{
  reset();const f=await start();cookie=f.browser;const result=await callback.GET(new Request(`http://localhost:3000/api/google/callback?state=${f.state}&error=access_denied&error_description=PRIVATE`));assert.equal(result.status,303);assert(result.headers.get('location').endsWith('google=denied'));assert(!result.headers.get('location').includes('PRIVATE'));assert.equal(result.headers.get('cache-control'),'private, no-store');
});
test('Identity library rejection and incomplete permissions cannot enable a connection',async()=>{
  reset();let f=await start();identityError=true;await assert.rejects(()=>finish(f));assert(!row.enabled);assert.equal(row.refresh_ciphertext,null);
  reset();f=await start();scopesOK=false;await assert.rejects(()=>finish(f),e=>e.notice==='permissions');assert(!row.enabled);
});
test('Meet support uses read-only calendar metadata; revocation sends token in POST body',async()=>{
  const oldFetch=global.fetch, calls=[];
  try {
    global.fetch=async(url,options)=>{calls.push({url,options});return Response.json({conferenceProperties:{allowedConferenceSolutionTypes:['hangoutsMeet']}})};
    assert.equal(await provider.calendarSupportsMeet('fixture-access'),true);
    assert.equal(calls[0].url,'https://www.googleapis.com/calendar/v3/calendars/primary?fields=id,conferenceProperties');assert.equal(calls[0].options.method,undefined);
    assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-access');
    global.fetch=async(url,options)=>{calls.push({url,options});return new Response('',{status:200})};
    assert.equal(await provider.revokeToken('fixture-refresh'),true);assert(!calls[1].url.includes('fixture-refresh'));assert.equal(calls[1].options.method,'POST');assert.equal(calls[1].options.body.get('token'),'fixture-refresh');
    global.fetch=async()=>new Response('',{status:503});assert.equal(await provider.revokeToken('fixture-refresh'),false);
    global.fetch=async()=>Response.json({error:'invalid_token'},{status:400});assert.equal(await provider.revokeToken('fixture-refresh'),true);
    global.fetch=async()=>new Response('',{status:403});await assert.rejects(()=>provider.calendarSupportsMeet('fixture-access'),e=>e.kind==='permissions');
  } finally {global.fetch=oldFetch;}
});
