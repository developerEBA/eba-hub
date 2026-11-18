// POST-MIGRATION ONLY. This signs in three real test accounts in separate browser
// contexts, creates test meetings through the UI, verifies API + RLS, and cleans
// up only this run's uniquely named test series. No auth users are created.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
// Part 2 can send real Google invitations and configure recording. Only the
// operator may opt in; this script is never part of the mocked/default tests.
assert.equal(process.env.EBA_TEST_ALLOW_GOOGLE_EVENTS,"yes","Set EBA_TEST_ALLOW_GOOGLE_EVENTS=yes explicitly; live Calendar tests can create Google events and send invitations.");
const googleTest = process.argv.includes("--google");
const required = (name) => { assert(process.env[name], `Configure ${name} before running live verification.`); return process.env[name]; };
const url = process.env.EBA_TEST_BASE_URL ?? "http://localhost:3000";
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL"), key = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const serverKey = process.env.SUPABASE_SECRET_KEY ?? required("SUPABASE_SERVICE_ROLE_KEY");
const prefix = "DEV Calendar " + randomUUID();
console.log("Live test cleanup prefix: " + prefix);
const server = createClient(supabaseUrl, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
const identities = {};
const secrets = [];
for (const role of ["ADMIN","CEO","UNINVITED"]) {
  const email = required(`EBA_TEST_${role}_EMAIL`), password = required(`EBA_TEST_${role}_PASSWORD`);
  assert(/-test@enibrand\.com$/i.test(email), "Use explicitly named -test@enibrand.com accounts only.");
  identities[role] = { email, password }; secrets.push(password, serverKey);
}
const local = (date) => new Date(+date + 3600000).toISOString().slice(0,16);
let browser;
try {
  const { chromium } = await import("@playwright/test");
  browser = await chromium.launch({ headless: true });
  for (const [role, identity] of Object.entries(identities)) {
    const client = createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await client.auth.signInWithPassword({ email: identity.email, password: identity.password });
    assert(!result.error && result.data.user, `${role}: authentication failed.`);
    const membership = await client.from("staff_memberships").select("role,status").eq("user_id",result.data.user.id).single();
    assert(!membership.error && membership.data.status === "active" && ["ceo","admin"].includes(membership.data.role), `${role}: active CEO/Admin membership required.`);
    if (role !== "UNINVITED") assert.equal(membership.data.role, role.toLowerCase());
    identity.id = result.data.user.id; identity.client = client;
    identity.context = await browser.newContext(); identity.page = await identity.context.newPage();
    identity.page.setDefaultTimeout(30000);
    await identity.page.goto(url + "/sign-in");
    await identity.page.getByLabel("Username", { exact: true }).fill(identity.email.split("@")[0]);
    await identity.page.getByLabel("Password", { exact: true }).fill(identity.password);
    await identity.page.getByRole("button", { name: "Sign in", exact: true }).click();
    await identity.page.waitForURL(/\/dashboard(?:\?|$|\/)/);
    await identity.page.goto(url + "/dashboard/calendar");
    await identity.page.getByRole("heading", { name: "Calendar", exact: true }).waitFor();
  }
  assert.equal(new Set(Object.values(identities).map((identity) => identity.id)).size,3);
  const admin = identities.ADMIN, ceo = identities.CEO, outsider = identities.UNINVITED;
  async function prepare(identity,id) {
    for(let attempt=0;attempt<8;attempt++) {
      const response=await identity.page.request.post(`${url}/dashboard/calendar/api/${id}/sync`,{headers:{origin:new URL(url).origin},timeout:120000});
      assert.equal(response.status(),200,"Google preparation failed; inspect Settings and the occurrence status.");
      const detail=await (await identity.page.request.get(`${url}/dashboard/calendar/api/${id}`)).json();
      if(detail.sync_status==='synced'&&detail.recording_status==='configured')return detail;
      assert(!detail.link_error_code,"Google preparation needs attention; inspect the meeting details.");
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
    throw Error("Google conference/recording is not ready yet. Keep the test records and follow cleanup instructions.");
  }
  const ready = await admin.page.request.get(url + "/dashboard/calendar/api?view=upcoming");
  assert.equal(ready.status(),200,"Apply the migration and configure the server key before live tests.");
  const start = new Date(Math.ceil((Date.now() + 3*86400000)/3600000)*3600000), end = new Date(+start+3600000);
  async function upcoming(identity) {
    await identity.page.reload();
    await Promise.all([identity.page.waitForResponse((response) => response.url().includes("/dashboard/calendar/api?view=upcoming")),identity.page.getByRole("button", {name:"Upcoming",exact:true}).click()]);
  }
  async function save(page,button) {
    const [response] = await Promise.all([page.waitForResponse((response) => response.request().method()==="POST" && response.url().endsWith("/dashboard/calendar/api")),page.getByRole("button",{name:button,exact:true}).click()]);
    const value = await response.json(); assert.equal(response.status(),200,JSON.stringify(value)); return value;
  }
  await admin.page.getByRole("button", {name:/Add Meeting/}).first().click();
  await admin.page.getByLabel("Title",{exact:true}).fill(prefix);
  await admin.page.locator('input[name="start"]').fill(local(start)); await admin.page.locator('input[name="end"]').fill(local(end));
  await admin.page.locator(`input[name="attendees"][value="${ceo.id}"]`).check();
  const created = await save(admin.page,"Schedule meeting");
  const id=created.id, card=`button[data-meeting-id="${id}"]`;
  let googleIdentity;
  if(googleTest) {
    const detail=await prepare(admin,id);assert.match(detail.join_url,/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    const first=await server.from("calendar_occurrences").select("provider_event_id,provider_conference_id").eq("id",id).single();
    assert(!first.error&&first.data.provider_event_id&&first.data.provider_conference_id);googleIdentity=first.data;
    await prepare(admin,id);
    const again=await server.from("calendar_occurrences").select("provider_event_id,provider_conference_id").eq("id",id).single();assert.deepEqual(again.data,googleIdentity);
    for(const denied of [ceo,outsider])assert.equal((await denied.page.request.post(`${url}/dashboard/calendar/api/${id}/sync`,{headers:{origin:new URL(url).origin}})).status(),404);
    console.log("PASS real Google event/Meet link and confirmed recording configuration; retries preserve both identities.");
  }
  await upcoming(admin); await upcoming(ceo);
  await admin.page.locator(card).waitFor(); await ceo.page.locator(card).waitFor();
  console.log("PASS Admin schedules CEO; both see the same occurrence.");

  const denied=await outsider.page.request.get(`${url}/dashboard/calendar/api/${id}`); assert.equal(denied.status(),404);
  const hidden=await outsider.client.from("calendar_occurrences").select("id,title,agenda").eq("id",id); assert(!hidden.error); assert.deepEqual(hidden.data,[]);
  const details=await (await admin.page.request.get(`${url}/dashboard/calendar/api/${id}`)).json();
  const ceoWrite=await ceo.page.request.post(url+"/dashboard/calendar/api",{headers:{Origin:new URL(url).origin},data:{command:"cancel",requestId:randomUUID(),id,version:details.version,scope:"one"}}); assert.equal(ceoWrite.status(),404);
  const rawWrite=await ceo.client.from("calendar_occurrences").update({title:"Forbidden"}).eq("id",id); assert(rawWrite.error,"Direct database writes must be denied.");
  await ceo.page.locator(card).click(); assert.equal(await ceo.page.getByRole("button",{name:"Edit meeting",exact:true}).count(),0); await ceo.page.getByRole("button",{name:"Close meeting"}).click();
  console.log("PASS uninvited active account denied by HTTP and RLS; invited CEO is read-only.");

  await admin.page.locator(card).click(); await admin.page.getByRole("button",{name:"Edit meeting",exact:true}).click();
  await admin.page.getByLabel("Title",{exact:true}).fill(prefix+" rescheduled");
  await admin.page.locator('input[name="start"]').fill(local(new Date(+start+86400000))); await admin.page.locator('input[name="end"]').fill(local(new Date(+end+86400000)));
  await save(admin.page,"Save changes"); await upcoming(admin); await upcoming(ceo);
  await admin.page.locator(card).getByText(prefix+" rescheduled",{exact:true}).waitFor(); await ceo.page.locator(card).getByText(prefix+" rescheduled",{exact:true}).waitFor();
  const overviewRecords=(await (await ceo.page.request.get(url+"/dashboard/calendar/api?view=upcoming")).json()).meetings.slice(0,3);
  await ceo.page.goto(url+"/dashboard");
  for(const meeting of overviewRecords)await ceo.page.locator(`a[href="/dashboard/calendar?meeting=${meeting.id}"]`).waitFor();
  console.log("PASS rescheduling updates Admin, CEO and Overview.");
  if(googleTest){await prepare(admin,id);const changed=await server.from("calendar_occurrences").select("provider_event_id,provider_conference_id").eq("id",id).single();assert.deepEqual(changed.data,googleIdentity);}
  await admin.page.locator(card).click(); await admin.page.getByRole("button",{name:"Cancel meeting",exact:true}).click(); await save(admin.page,"Confirm cancellation");
  for(const identity of [admin,ceo]) {const response=await identity.page.request.get(url+"/dashboard/calendar/api?view=upcoming");assert(!(await response.json()).meetings.some((meeting)=>meeting.id===id));}
  await ceo.page.reload();assert.equal(await ceo.page.locator(`a[href="/dashboard/calendar?meeting=${id}"]`).count(),0);
  console.log("PASS cancellation removes the occurrence from both upcoming lists.");

  await admin.page.getByRole("button",{name:/Add Meeting/}).first().click();
  await admin.page.getByLabel("Title",{exact:true}).fill(prefix+" weekly");await admin.page.locator('input[name="start"]').fill(local(start));await admin.page.locator('input[name="end"]').fill(local(end));
  await admin.page.getByLabel("Repeats",{exact:true}).selectOption("weekly");await admin.page.getByLabel("Last meeting date",{exact:true}).fill(local(new Date(+start+14*86400000)).slice(0,10));await admin.page.locator(`input[name="attendees"][value="${ceo.id}"]`).check();
  const series=await save(admin.page,"Schedule meeting");await upcoming(admin);
  let weeklyGoogle=[];
  if(googleTest) {
    const root=await server.from("calendar_occurrences").select("series_id").eq("id",series.id).single();assert(!root.error);
    const rows=await server.from("calendar_occurrences").select("id,version,starts_at,ends_at").eq("series_id",root.data.series_id).order("ordinal");assert(!rows.error&&rows.data.length===3);
    for(const row of rows.data)await prepare(admin,row.id);
    weeklyGoogle=(await server.from("calendar_occurrences").select("id,provider_event_id,provider_conference_id").eq("series_id",root.data.series_id).order("ordinal")).data;
    const one=rows.data[1];
    const moved=await admin.page.request.post(url+"/dashboard/calendar/api",{headers:{origin:new URL(url).origin},data:{command:"update",requestId:randomUUID(),scope:"one",id:one.id,version:one.version,title:prefix+" single exception",agenda:"One occurrence moved",start:local(new Date(+new Date(one.starts_at)+86400000)),end:local(new Date(+new Date(one.ends_at)+86400000)),frequency:"weekly",attendees:[ceo.id],departments:[]}});assert.equal(moved.status(),200);await prepare(admin,one.id);
    const unchanged=(await server.from("calendar_occurrences").select("id,provider_event_id,provider_conference_id").eq("series_id",root.data.series_id).order("ordinal")).data;assert.deepEqual(unchanged,weeklyGoogle);
  }
  await admin.page.locator(`button[data-meeting-id="${series.id}"]`).click();await admin.page.getByRole("button",{name:"Edit meeting",exact:true}).click();
  await admin.page.getByLabel("Apply this change to").selectOption("remaining");await admin.page.getByLabel("Title",{exact:true}).fill(prefix+" remaining");await save(admin.page,"Save changes");
  const weekly=await (await admin.page.request.get(url+"/dashboard/calendar/api?view=upcoming")).json();assert.equal(weekly.meetings.filter((meeting)=>meeting.title===prefix+" remaining").length,3);
  if(googleTest) {
    for(const row of weeklyGoogle)await prepare(admin,row.id);
    const updated=(await server.from("calendar_occurrences").select("id,provider_event_id,provider_conference_id").in("id",weeklyGoogle.map(row=>row.id))).data;
    assert.deepEqual(updated.sort((a,b)=>a.id.localeCompare(b.id)),[...weeklyGoogle].sort((a,b)=>a.id.localeCompare(b.id)));
    console.log("PASS real Google weekly occurrences keep event/Meet identity through one-occurrence and remaining-series edits.");
  }
  await upcoming(admin);await admin.page.locator(`button[data-meeting-id="${series.id}"]`).click();await admin.page.getByRole("button",{name:"Cancel meeting",exact:true}).click();await admin.page.getByLabel("Apply this change to").selectOption("remaining");await save(admin.page,"Confirm cancellation");
  const cancelled=await (await ceo.page.request.get(url+"/dashboard/calendar/api?view=upcoming")).json();assert(!cancelled.meetings.some((meeting)=>meeting.title.startsWith(prefix)));
  console.log("PASS weekly recurrence and remaining-series editing/cancellation.");
  if(googleTest) {
    const response=await ceo.page.request.post(url+"/dashboard/calendar/api",{headers:{origin:new URL(url).origin},data:{command:"create",requestId:randomUUID(),scope:"one",title:prefix+" CEO organizer",agenda:"Development verification",start:local(start),end:local(end),frequency:"once",until:null,attendees:[admin.id],departments:[]}});
    assert.equal(response.status(),200);const own=await response.json();await prepare(ceo,own.id);
    assert.equal((await admin.page.request.post(`${url}/dashboard/calendar/api/${own.id}/sync`,{headers:{origin:new URL(url).origin}})).status(),404);
    console.log("PASS CEO can prepare their own event; shared Google authorization does not let Admin retry another organizer's meeting.");
  }
} catch(error) {
  let message=error instanceof Error?error.message:String(error);for(const secret of secrets)message=message.split(secret).join("[redacted]");
  console.error(message);process.exitCode=1;
} finally {
  // Never hard-delete before Google cancellation is confirmed: the tombstone
  // and durable job are needed to recover ambiguous or failed remote operations.
  for(const identity of [identities.ADMIN,identities.CEO]) {
    if(!identity.id)continue;
    try {
      const rows=await server.from("calendar_occurrences").select("id,series_id,status,version,ends_at").eq("organizer_id",identity.id).like("title",prefix+"%");
      assert(!rows.error);
      for(const row of rows.data??[]) {
        if(row.status==='scheduled'){
          const result=await server.rpc("calendar_mutate",{p_actor:identity.id,p_request:randomUUID(),p_command:"cancel",p_occurrence:row.id,p_scope:"one",p_version:row.version,p_payload:{}});assert(!result.error,"Local test cancellation failed.");
        }
        const response=await identity.page.request.post(`${url}/dashboard/calendar/api/${row.id}/sync`,{headers:{origin:new URL(url).origin},timeout:120000});assert.equal(response.status(),200);
      }
      const final=await server.from("calendar_occurrences").select("id,series_id,status,sync_status").eq("organizer_id",identity.id).like("title",prefix+"%");assert(!final.error);
      const ids=[...new Set((final.data??[]).filter(row=>row.status==='cancelled'&&row.sync_status==='synced').map(row=>row.series_id))]
        .filter(seriesId=>final.data.filter(row=>row.series_id===seriesId).every(row=>row.status==='cancelled'&&row.sync_status==='synced'));
      if(ids.length){const result=await server.from("calendar_series").delete().eq("organizer_id",identity.id).in("id",ids);assert(!result.error)}
      if((final.data??[]).some(row=>!ids.includes(row.series_id)))throw Error("Remote cancellation remains pending");
    } catch {
      console.error("Cleanup incomplete. Retained this run's DEV Calendar records and sync jobs. Reconnect Google if needed, retry cancellation, then remove only this run's fully cancelled series.");process.exitCode=1;
    }
  }
  for(const identity of Object.values(identities))await identity.client?.auth.signOut({scope:"local"});
  await browser?.close();
}
