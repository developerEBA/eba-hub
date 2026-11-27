/* eslint-disable @typescript-eslint/no-require-imports*/
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript");
const root = path.resolve(__dirname, "..");
for (const ext of [".ts", ".tsx"])
  require.extensions[ext] = (m, f) =>
    m._compile(
      ts.transpileModule(fs.readFileSync(f, "utf8"), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      f,
    );
function load(file, stubs = {}) {
  const filename = path.join(root, file);
  delete require.cache[filename];
  const old = Module._load;
  try {
    Module._load = function (name, ...args) {
      return Object.hasOwn(stubs, name) ? stubs[name] : old.call(this, name, ...args);
    };
    return require(filename);
  } finally {
    Module._load = old;
  }
}
const { joinWindow } = require("../src/app/dashboard/calendar/join-window.ts"),
  { meetPresentation } = require("../src/app/dashboard/calendar/meet-model.ts");
const id = "12345678-1234-4234-8234-123456789abc",
  email = "admin@enibrand.com",
  url = "https://meet.google.com/abc-defg-hij";
const start = Date.parse("2030-11-20T11:00:00Z"),
  end = start + 3600000,
  closes = end + 3 * 3600000;
const meeting = () => ({
  id,
  organizer_id: "admin",
  title: "Fixture",
  starts_at: new Date(start).toISOString(),
  ends_at: new Date(end).toISOString(),
  status: "scheduled",
  join_url: url,
  version: 1,
  provider_calendar_id: email,
  provider_event_id: "event",
  sync_status: "synced",
});
test("Join opens exactly at start and closes exactly three hours after end, including Lagos midnight", () => {
  const m = meeting();
  for (const [now, state] of [
    [start - 1, "waiting"],
    [start, "open"],
    [end, "open"],
    [closes - 1, "open"],
    [closes, "expired"],
    [closes + 1, "expired"],
  ])
    assert.equal(joinWindow(m, now).state, state);
  const overnight = {
    ...m,
    starts_at: "2030-11-20T23:30:00+01:00",
    ends_at: "2030-11-21T00:30:00+01:00",
  };
  assert.equal(joinWindow(overnight, Date.parse("2030-11-21T03:29:59+01:00")).state, "open");
  assert.equal(joinWindow(overnight, Date.parse("2030-11-21T03:30:00+01:00")).state, "expired");
});
test("Manual closure and cancellation override grace; next recurrence has an independent window", () => {
  const first = { ...meeting(), joining_closed_at: new Date(start + 1000).toISOString() };
  assert.equal(joinWindow(first, start + 2000).state, "closed");
  assert.equal(joinWindow({ ...meeting(), status: "cancelled" }, start).state, "cancelled");
  const next = {
    ...meeting(),
    id: "next",
    starts_at: new Date(start + 7 * 86400000).toISOString(),
    ends_at: new Date(end + 7 * 86400000).toISOString(),
  };
  assert.equal(joinWindow(next, start + 7 * 86400000 - 1).state, "waiting");
  assert.equal(joinWindow(next, start + 7 * 86400000).state, "open");
  assert.equal(meetPresentation(meeting(), closes - 1).url, url);
  assert.equal(meetPresentation(meeting(), closes).url, null);
});
test("Actual protected Join handler rejects old saved links at the cutoff and after Admin closure", async () => {
  let now = start,
    signed = true,
    row = meeting();
  const route = load("src/app/dashboard/calendar/api/[id]/join/route.ts", {
    "../../../join-window": { joinWindow: (m) => joinWindow(m, now) },
    "../../../server": {
      calendarHeaders: {},
      calendarAuth: async () =>
        signed ? { client: {}, user: { id: "actor" }, role: "CEO" } : null,
      findMeeting: async () => ({ data: row, error: null }),
    },
  });
  const run = () =>
    route.GET(new Request("http://localhost:3000"), { params: Promise.resolve({ id }) });
  now = start - 1;
  assert.equal((await run()).status, 409);
  now = start;
  assert.equal((await run()).status, 303);
  now = closes - 1;
  assert.equal((await run()).status, 303);
  now = closes;
  assert.equal((await run()).status, 410);
  now = start;
  row = { ...row, joining_closed_at: new Date(start).toISOString() };
  assert.equal((await run()).status, 410);
  signed = false;
  assert.equal((await run()).status, 401);
});
const providerModule = load("src/lib/calendar-google/provider.ts", { "server-only": {} });
const { endClaim } = load("src/lib/calendar-google/call-ending.ts", {
  "server-only": {},
  "../../app/dashboard/calendar/server": {},
  "../google-organizer/server": {},
});
function fixture() {
  const calls = [],
    claim = { meeting: meeting(), job: { lease: "fixture-lease" } },
    f = {
      claim,
      calls,
      active: "conferenceRecords/current",
      conflict: false,
      deny: false,
      lost: false,
    };
  f.provider = {
    getEvent: async () => {
      calls.push("event");
      return { id: "event", organizer: { email }, hangoutLink: url };
    },
    getSpace: async () => {
      calls.push("space");
      return {
        name: "spaces/canonical",
        meetingUri: url,
        ...(f.active ? { activeConference: { conferenceRecord: f.active } } : {}),
      };
    },
    getConferenceRecord: async (name) => {
      calls.push("record");
      return { name, startTime: new Date(start + 1000).toISOString() };
    },
    endActiveConference: async (name) => {
      assert.equal(name, "spaces/canonical");
      calls.push("end");
      if (f.deny) throw new providerModule.GoogleHttpError(403);
      f.active = null;
      if (f.lost) throw new providerModule.GoogleHttpError(504);
    },
  };
  f.control = async (action, data) => {
    calls.push(action);
    if (action === "assert") return f.conflict ? { conflict: true } : { valid: true };
    if (action === "bind") {
      claim.job.space_name = data.space;
      claim.job.conference_record = data.conference;
      return { valid: true };
    }
    if (action === "finish") {
      f.state = data.state;
      return { state: data.state };
    }
  };
  f.run = () => endClaim(claim, f.provider, email, f.control, closes);
  return f;
}
test("Google ending is confirmed only after the observed conference is no longer active", async () => {
  const f = fixture();
  assert.equal(await f.run(), "ended");
  assert.equal(f.calls.filter((c) => c === "end").length, 1);
  assert.equal(f.state, "ended");
  assert(f.claim.job.conference_record);
});
test("Google permission rejection is unavailable, never a false ended result", async () => {
  const f = fixture();
  f.deny = true;
  assert.equal(await f.run(), "unavailable");
  assert.equal(f.active, "conferenceRecords/current");
  assert.equal(f.state, "unavailable");
});
test("No active call is distinct from ending a call; a replaced conference is never terminated by retry", async () => {
  const f = fixture();
  f.active = null;
  assert.equal(await f.run(), "no_active_call");
  assert(!f.calls.includes("end"));
  const replaced = fixture();
  replaced.claim.job.conference_record = "conferenceRecords/previous";
  assert.equal(await replaced.run(), "ended");
  assert(!replaced.calls.includes("end"));
  assert.equal(replaced.active, "conferenceRecords/current");
});
test("An ambiguous end response retries against the bound conference without ending a replacement", async () => {
  const f = fixture();
  f.lost = true;
  assert.equal(await f.run(), "retry");
  assert.equal(f.active, null);
  f.lost = false;
  assert.equal(await f.run(), "ended");
  assert.equal(f.calls.filter((c) => c === "end").length, 1);
});
test("Shared active occurrence and out-of-window conference identities fail safely", async () => {
  const f = fixture();
  f.conflict = true;
  assert.equal(await f.run(), "shared_space");
  assert(!f.calls.includes("event"));
  const old = fixture();
  old.provider.getConferenceRecord = async (name) => ({
    name,
    startTime: new Date(start - 1).toISOString(),
  });
  assert.equal(await old.run(), "unavailable");
  assert(!old.calls.includes("end"));
});
test("A conference replaced just before POST is not ended", async () => {
  const f = fixture();
  let reads = 0;
  const original = f.provider.getSpace;
  f.provider.getSpace = async (...args) => {
    reads++;
    if (reads === 2) f.active = "conferenceRecords/new";
    return original(...args);
  };
  assert.equal(await f.run(), "ended");
  assert(!f.calls.includes("end"));
  assert.equal(f.active, "conferenceRecords/new");
});

test("Foreign Google ownership, incomplete readback and stale database completion never claim termination", async () => {
  const foreign = fixture();
  foreign.provider.getEvent = async () => ({
    organizer: { email: "someone@example.com" },
    hangoutLink: url,
  });
  assert.equal(await foreign.run(), "unavailable");
  assert(!foreign.calls.includes("end"));
  const incomplete = fixture(),
    read = incomplete.provider.getSpace;
  let reads = 0;
  incomplete.provider.getSpace = async () => (++reads === 3 ? {} : read());
  assert.equal(await incomplete.run(), "retry");
  assert.equal(incomplete.state, "retry");
  const stale = fixture(),
    control = stale.control;
  stale.control = async (a, d) => (a === "finish" ? null : control(a, d));
  assert.equal(await stale.run(), "retry");
});

test("Superseded schedule/lease stops immediately before destructive Google I/O", async () => {
  const f = fixture(),
    control = f.control;
  let checks = 0;
  f.control = async (a, d) => (a === "assert" && ++checks > 1 ? null : control(a, d));
  assert.equal(await f.run(), "retry");
  assert(!f.calls.includes("end"));
});

test("Joining phases distinguish upcoming, normal, grace and closed with an injected clock", () => {
  for (const [now, phase] of [
    [start - 1, "Upcoming"],
    [start, "Join Meeting"],
    [end, "Grace period"],
    [closes, "Closed"],
  ])
    assert.equal(joinWindow(meeting(), now).phase, phase);
});

test("Actual ownership helper requires the Admin organizer and configured provider identity without exposing IDs", async () => {
  const before = process.env.GOOGLE_ORGANIZER_EMAIL;
  process.env.GOOGLE_ORGANIZER_EMAIL = email;
  let row = {
    organizer_id: "admin",
    provider_calendar_id: email,
    provider_event_id: "private-event",
  };
  const q = {
    select: () => q,
    eq: () => q,
    abortSignal: () => q,
    maybeSingle: async () => ({ data: row }),
  };
  const { endPermission } = load("src/lib/calendar-google/end-permission.ts", {
    "server-only": {},
    "../../app/dashboard/calendar/server": { calendarAdmin: () => ({ from: () => q }) },
  });
  try {
    assert.equal(await endPermission(id, "admin"), "eligible");
    assert.equal(await endPermission(id, "other-admin"), "not_manager");
    row = { ...row, provider_calendar_id: "foreign@example.com" };
    assert.equal(await endPermission(id, "admin"), "foreign_owner");
  } finally {
    if (before === undefined) delete process.env.GOOGLE_ORGANIZER_EMAIL;
    else process.env.GOOGLE_ORGANIZER_EMAIL = before;
  }
});

test("Forward reconciliation retains private management, bounded retries and idempotent completed jobs", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20261119100000_meeting_closure_management.sql"),
    "utf8",
  );
  for (const p of [
    /o.organizer_id is distinct from p_actor/,
    /g.email=o.provider_calendar_id/,
    /j.state in\('ended','no_active_call'\)/,
    /attempts>=8/,
    /least\(900,60\*power/,
    /joining_closed_at=coalesce/,
    /call_end_status='reconnect_required'/,
    /revoke all.*from public,anon,authenticated/,
  ])
    assert.match(sql, p);
  assert.match(sql, /old.call_end_status in\('ended','no_active_call'\)/);
  assert.match(sql, /calendar_call_end_terminal_history after update/);
  const diagnostic = fs.readFileSync(
    path.join(root, "supabase/checks/meeting_closure_diagnostic.sql"),
    "utf8",
  );
  assert.match(diagnostic, /begin transaction read only/);
  assert.match(diagnostic, /rollback;/);
  assert.match(diagnostic, /PASS.*FAIL/);
});

test("Actual worker claims durable Hub closure before auth and reports disconnected/revoked Google separately", async () => {
  const savedEmail = process.env.GOOGLE_ORGANIZER_EMAIL,
    savedFlag = process.env.GOOGLE_MEET_CALL_ENDING_ENABLED;
  process.env.GOOGLE_ORGANIZER_EMAIL = email;
  process.env.GOOGLE_MEET_CALL_ENDING_ENABLED = "true";
  let enabled = false;
  const actions = [];
  let finish;
  const db = {
    from: (table) => {
      const q = {
        select: () => q,
        lte: () => q,
        in: () => q,
        limit: () => q,
        eq: () => q,
        abortSignal: () =>
          table === "calendar_call_end_jobs"
            ? Promise.resolve({ data: [{ occurrence_id: id }] })
            : q,
        single: async () => ({ data: { enabled, email } }),
      };
      return q;
    },
    rpc: (_name, p) => ({
      abortSignal: async () => {
        actions.push(p.p_action);
        if (p.p_action === "claim")
          return { data: { meeting: meeting(), job: { lease: "fixture" } } };
        finish = p.p_data;
        return { data: { valid: true } };
      },
    }),
  };
  const { runCallEnding } = load("src/lib/calendar-google/call-ending.ts", {
    "server-only": {},
    "../../app/dashboard/calendar/server": { calendarAdmin: () => db },
    "../google-organizer/server": {
      organizerAccess: async () => {
        actions.push("auth");
        throw Object.assign(Error("fixture"), { kind: "revoked" });
      },
    },
  });
  try {
    let result = await runCallEnding(id);
    assert.equal(result.ended, 0);
    assert.deepEqual(actions, ["claim", "finish"]);
    assert.equal(finish.reason, "additional_authorization_required");
    enabled = true;
    actions.length = 0;
    result = await runCallEnding(id);
    assert.equal(result.ended, 0);
    assert.deepEqual(actions, ["claim", "auth", "finish"]);
    assert.equal(finish.reason, "additional_authorization_required");
  } finally {
    if (savedEmail === undefined) delete process.env.GOOGLE_ORGANIZER_EMAIL;
    else process.env.GOOGLE_ORGANIZER_EMAIL = savedEmail;
    if (savedFlag === undefined) delete process.env.GOOGLE_MEET_CALL_ENDING_ENABLED;
    else process.env.GOOGLE_MEET_CALL_ENDING_ENABLED = savedFlag;
  }
});
test("Only Admin may request early end; unavailable Google ending is reported as partial, not success", async () => {
  let role = "CEO",
    now = start,
    row = meeting(),
    requests = 0,
    signed = true;
  const route = load("src/app/dashboard/calendar/api/[id]/end/route.ts", {
    "../../../../../../lib/calendar-google/end-permission": {
      endPermission: async () =>
        row.provider_calendar_id === email ? "eligible" : "foreign_owner",
    },
    "../../../join-window": { joinWindow: (m) => joinWindow(m, now) },
    "../../../server": {
      calendarHeaders: {},
      calendarAuth: async () => (signed ? { client: {}, user: { id: "admin" }, role } : null),
      findMeeting: async () => ({ data: row, error: null }),
      calendarAdmin: () => ({
        rpc: async () => {
          requests++;
          row = {
            ...row,
            joining_closed_at: new Date(start).toISOString(),
            call_end_status: "unavailable",
          };
          return { data: { pending: true }, error: null };
        },
      }),
    },
    "../../../../../../lib/calendar-google/call-ending": {
      runCallEnding: async () => ({ processed: 1, ended: 0 }),
    },
  });
  const req = () =>
      new Request("http://localhost:3000/dashboard/calendar/api/" + id + "/end", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    ctx = { params: Promise.resolve({ id }) };
  assert.equal((await route.POST(req(), ctx)).status, 403);
  role = "Admin";
  now = start - 1;
  assert.equal((await route.POST(req(), ctx)).status, 409);
  assert.equal(requests, 0);
  now = start;
  const response = await route.POST(req(), ctx);
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.match(result.message, /Google call termination is unavailable/);
  assert(row.joining_closed_at);
  row = { ...meeting(), organizer_id: "other-admin" };
  assert.equal((await route.POST(req(), ctx)).status, 403);
  row = { ...meeting(), source: "google", provider_calendar_id: "other@example.com" };
  assert.equal((await route.POST(req(), ctx)).status, 403);
  assert.equal(requests, 1);
  signed = false;
  assert.equal((await route.POST(req(), ctx)).status, 401);
  signed = true;
  assert.equal(
    (await route.POST(new Request(req(), { headers: { origin: "https://foreign.invalid" } }), ctx))
      .status,
    403,
  );
  assert.equal(requests, 1);
});
test("Actual Google end endpoint uses the canonical name, POST and an empty body", async () => {
  const old = global.fetch;
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://meet.googleapis.com/v2/spaces/canonical:endActiveConference");
    assert.equal(options.method, "POST");
    assert.equal(options.body, undefined);
    return Response.json({});
  };
  try {
    await new providerModule.CalendarGoogleProvider(
      async () => "fixture",
      Date.now() + 1000,
    ).endActiveConference("spaces/canonical");
    assert.equal(calls, 1);
  } finally {
    global.fetch = old;
  }
});
test("Durable SQL jobs fence versions, leases, shared spaces and browser execution", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20261118100000_meeting_join_windows.sql"),
    "utf8",
  );
  for (const pattern of [
    /ends_at\+interval '3 hours'/,
    /role='admin' and status='active'/,
    /j.desired_version<>o.version/,
    /j.lease is distinct from p_lease/,
    /j.next_attempt_at>clock_timestamp\(\)/,
    /on conflict\(join_key\) do update/,
    /calendar_call_end_space_leases.lease_until<clock_timestamp\(\)/,
    /other.id<>o.id/,
    /other.starts_at<=v_now/,
    /revoke all on public.calendar_call_end_jobs from public,anon,authenticated/,
    /Meeting call-ending check in progress/,
  ])
    assert.match(sql, pattern);
});
