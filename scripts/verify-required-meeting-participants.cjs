/* eslint-disable @typescript-eslint/no-require-imports*/
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const compile=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
require.extensions['.ts']=compile;
const base=path.join(root,'src/lib/calendar-google');
const model=require(path.join(base,'import-model.ts'));
const prep=require(path.join(base,'import-preparation.ts'));
const event=(overrides={})=>({id:'owned-event',etag:'etag-1',organizer:{email:'organizer@enibrand.com'},status:'confirmed',summary:'Planning',start:{dateTime:'2030-01-01T09:00:00Z'},end:{dateTime:'2030-01-01T10:00:00Z'},attendees:[{email:'guest@enibrand.com',responseStatus:'accepted'}],...overrides});

test('Organizer-owned Google event receives missing required invites once using ETag',async()=>{
 let writes=0,body;
 const provider={patchEvent:async(id,etag,value)=>{writes++;assert.equal(id,'owned-event');assert.equal(etag,'etag-1');body=value;return event({...event(),attendees:value.attendees});}};
 const required=['ceo@enibrand.com','hod@enibrand.com','guest@enibrand.com','organizer@enibrand.com'];
 const first=await prep.ensureRequiredInvitations(provider,event(), 'organizer@enibrand.com',required);
 assert.equal(first.eligible,true);assert.equal(first.updated,true);assert.equal(writes,1);
 assert.deepEqual(body.attendees.map(x=>x.email),['guest@enibrand.com','ceo@enibrand.com','hod@enibrand.com']);
 const second=await prep.ensureRequiredInvitations(provider,first.event,'organizer@enibrand.com',required);
 assert.equal(second.eligible,true);assert.equal(second.updated,false);assert.equal(writes,1);
});

test('External organizer events are not imported or modified',async()=>{
 const external=event({organizer:{email:'outside@example.com'}});
 assert.equal(model.incomingEvent(external,'organizer@enibrand.com'),null);
 let writes=0;
 const result=await prep.ensureRequiredInvitations({patchEvent:async()=>{writes++;return external;}},external,'organizer@enibrand.com',['hod@enibrand.com']);
 assert.equal(result.eligible,false);assert.equal(writes,0);
});

test('Required invitation update failure leaves event unavailable for import retry',async()=>{
 const noEtag=event({etag:undefined});
 const result=await prep.ensureRequiredInvitations({patchEvent:async()=>{throw Error('mock provider failure');}},noEtag,'organizer@enibrand.com',['hod@enibrand.com']);
 assert.equal(result.eligible,false);assert.equal(result.event,noEtag);
});

test('Migration retains legacy provenance and protects direct attendee mutation paths',()=>{
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261126120000_required_meeting_participants.sql'),'utf8');
 for(const pattern of [
  /legacy_unclassified/,
  /alter function public\.calendar_mutate\([^;]+rename to calendar_mutate_v1/i,
  /create function public\.calendar_mutate\(/i,
  /eba_explicit_attendees/i,
  /active eligible CEO, Admin or assigned HOD attendees/i,
  /department_invite[\s\S]+calendar_reminder_account_active/i,
  /pg_advisory_xact_lock\(hashtextextended\(p_actor::text\|\|p_request::text,0\)\)[\s\S]+calendar_requests/i,
  /existing_request\.request_hash not in\(wrapped_hash,legacy_hash\)/i,
  /alter function public\.calendar_hod_create\([^;]+rename to calendar_hod_create_v1/i,
  /create function public\.calendar_hod_create\(/i,
  /before insert or update of attendee_ids,status,ends_at on public\.calendar_occurrences/i,
  /create function eba_private\.calendar_reconcile_participant_user/i,
  /create function public\.calendar_reconcile_required_participants\(/i,
  /create function public\.calendar_google_invitation_deltas\(/i,
  /calendar_google_import_v1/,
  /'preexisting_attendees'/i,
  /'revoked_required'/i,
  /if p_apply and not exists[\s\S]+role='admin'/i,
  /'required_communications_hod'/i,
  /department='communications'/i,
  /user_id uuid not null references auth\.users\(id\) on delete cascade/i,
  /Calendar alerts require current occurrence visibility[\s\S]+attendee_ids/i,
  /create or replace function public\.calendar_access\(\)[\s\S]+calendar_current_member/i,
  /calendar_auth_user_participant_reconcile/i,
  /stale_department_invites_removable/i,
  /grant execute on function public\.calendar_mutate\([^;]+to service_role/i,
  /revoke all on function public\.calendar_mutate\([^;]+from public,anon,authenticated/i,
 ])assert.match(migration,pattern);
 assert.doesNotMatch(migration,/delete\s+from\s+public\.calendar_occurrences/i);
 assert.doesNotMatch(migration,/delete\s+from\s+public\.calendar_series/i);
});

test('Scheduling form explains an empty eligible roster separately from a failed lookup',()=>{
 const form=fs.readFileSync(path.join(root,'src/app/dashboard/calendar/meeting-dialog.tsx'),'utf8');
 assert.match(form,/No active, verified CEO, Admin or Communications HOD memberships are currently eligible/);
 assert.match(form,/Required membership could not be loaded\. Refresh the directory before scheduling/);
});

test('Combined SQL verification emits one catalog-safe result and excludes client RPC access',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/checks/calendar_required_participants_verification.sql'),'utf8');
 assert.match(sql,/to_regclass\('public\.calendar_occurrences'\)/i);
 assert.match(sql,/to_regprocedure\('public\.calendar_reconcile_required_participants\(uuid,boolean\)'\)/i);
 assert.match(sql,/to_regprocedure\('public\.calendar_google_invitation_deltas\(text,text\[\]\)'\)/i);
 assert.match(sql,/google_snapshots_rls/i);
 assert.match(sql,/reminder_audience_policy/i);
 assert.match(sql,/auth_reconcile_trigger/i);
 assert.match(sql,/has_function_privilege\('authenticated'/i);
 assert.match(sql,/then 'PASS' else 'FAIL'/i);
 assert.doesNotMatch(sql,/\b(insert|update|delete|alter|create)\s+(into\s+)?public\./i);
});

test('Required-participant notification policy has balanced FOR ALL USING and WITH CHECK clauses',()=>{
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261126120000_required_meeting_participants.sql'),'utf8');
 const start=migration.toLowerCase().indexOf('create policy "calendar alerts require current occurrence visibility"');
 const end=migration.toLowerCase().indexOf("notify pgrst",start);
 assert(start>=0&&end>start);
 const policy=migration.slice(start,end).trim();
 assert.match(policy,/as restrictive for all to authenticated\s+using\s*\([\s\S]+\)\s+with check\s*\([\s\S]+\);$/i);
 assert.doesNotMatch(policy,/;\s*with check/i);
 let depth=0;
 for(const char of policy){if(char==='(')depth++;if(char===')')depth--;assert(depth>=0,'policy has an unmatched closing parenthesis')}
 assert.equal(depth,0,'policy parentheses are balanced');
 assert.match(policy,/calendar_access\(\)/i);
 assert.match(policy,/reminder_revision=calendar_revision/i);
 assert.match(policy,/any\(o\.attendee_ids\)/i);
 const recovery=fs.readFileSync(path.join(root,'supabase/recovery/calendar_required_participants_policy_repair.sql'),'utf8');
 assert.match(recovery,/any\(o\.attendee_ids\)/i);
});
