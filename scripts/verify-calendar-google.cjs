/* eslint-disable @typescript-eslint/no-require-imports*/
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript");
const root = path.resolve(__dirname, "..");

global.fetch = async () => {
  throw Error("Unexpected network call in mocked verification");
};
require.extensions[".ts"] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    f,
  );
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  return original.call(this, name, ...args);
};
const engine = require(root + "/src/lib/calendar-google/sync.ts"),
  { GoogleHttpError, CalendarGoogleProvider } = require(
    root + "/src/lib/calendar-google/provider.ts",
  ),
  presentation = require(root + "/src/app/dashboard/calendar/meet-model.ts");
Module._load = original;
const id = "12345678-1234-4234-8234-123456789abc",
  organizer = "admin",
  ceo = "ceo",
  workspace = "fixture-workspace",
  email = "organizer@enibrand.com";
function fixture() {
  const m = {
    id,
    series_id: "series",
    organizer_id: organizer,
    ordinal: 0,
    title: "Review",
    agenda: "Private agenda",
    starts_at: "2030-11-18T09:00:00Z",
    ends_at: "2030-11-18T10:00:00Z",
    attendee_ids: [ceo],
    frequency: "weekly",
    recurrence_until: "2030-12-02",
    version: 1,
    status: "scheduled",
    provider_event_id: null,
    provider_calendar_id: null,
    join_url: null,
    recording_status: "pending",
  };
  const job = {
    occurrence_id: id,
    desired_version: 1,
    attempts: 0,
    conference_generation: 0,
    create_attempted: false,
    cancel_settle_until: null,
    state: "pending",
    lease_token: null,
  };
  const f = {
    m,
    job,
    events: new Map(),
    inserts: 0,
    patches: 0,
    deletes: 0,
    recordings: 0,
    pending: false,
    recordError: null,
    recordResponse: "ON",
    insertTimeout: false,
    hook: null,
    people: [
      { user_id: organizer, email: "admin@enibrand.com" },
      { user_id: ceo, email: "ceo@enibrand.com" },
    ],
  };
  const copy = (v) => structuredClone(v);
  f.edit = (change) => {
    Object.assign(m, change);
    m.version++;
    job.desired_version = m.version;
    if (job.state !== "processing") job.state = "pending";
  };
  const valid = (c) =>
    job.lease_token === c.job.lease_token &&
    job.desired_version === c.meeting.version &&
    m.version === c.meeting.version;
  const repo = {
    claim: async () => {
      if (!["pending", "retry"].includes(job.state)) return null;
      job.state = "processing";
      job.lease_token = "lease-" + Math.random();
      job.attempts++;
      return copy({ meeting: m, job });
    },
    current: async (c) => {
      if (!valid(c)) {
        if (job.lease_token === c.job.lease_token) {
          job.state = "pending";
          job.lease_token = null;
        }
        return false;
      }
      return true;
    },
    bind: async (c, e, eventId, attempt) => {
      if (!valid(c)) return false;
      m.provider_event_id = eventId;
      m.provider_calendar_id = e;
      if (attempt) {
        job.create_attempted = true;
        job.cancel_settle_until = new Date(Date.now() + 86400000).toISOString();
      }
      return true;
    },
    people: async () => copy(f.people),
    finish: async (c, result) => {
      if (!valid(c)) {
        job.state = "pending";
        return false;
      }
      Object.assign(m, {
        sync_status: result.sync_status,
        recording_status: result.recording_status,
        link_error_code: result.link_error_code ?? null,
      });
      if ("join_url" in result) m.join_url = result.join_url;
      Object.assign(job, { state: result.state, error_code: result.error_code, lease_token: null });
      f.last = copy(result);
      return true;
    },
  };
  function conference(body) {
    return {
      conferenceId: "abc-defg-hij",
      conferenceSolution: { key: { type: "hangoutsMeet" } },
      createRequest: {
        requestId:
          body.conferenceData?.createRequest?.requestId ??
          engine.conferenceRequestFor(id, job.conference_generation),
        status: { statusCode: f.pending ? "pending" : "success" },
      },
      entryPoints: f.pending
        ? []
        : [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
    };
  }
  f.ready = () => {
    for (const e of f.events.values())
      e.conferenceData = conference({ conferenceData: e.conferenceData });
  };
  const provider = {
    getEvent: async (eventId) => {
      if (f.hook) await f.hook("get");
      return copy(f.events.get(eventId) ?? null);
    },
    insertEvent: async (body) => {
      f.inserts++;
      if (f.events.has(body.id)) throw new GoogleHttpError(409);
      const e = {
        ...copy(body),
        etag: "e1",
        status: "confirmed",
        conferenceData: conference(body),
      };
      f.events.set(e.id, e);
      if (f.hook) await f.hook("insert");
      if (f.insertTimeout) throw new GoogleHttpError(503);
      return copy(e);
    },
    patchEvent: async (eventId, etag, body) => {
      const e = f.events.get(eventId);
      if (e.etag !== etag) throw new GoogleHttpError(412);
      f.patches++;
      Object.assign(e, copy(body), { etag: "e" + (f.patches + 1) });
      if (body.conferenceData) e.conferenceData = conference(body);
      if (f.hook) await f.hook("patch");
      return copy(e);
    },
    deleteEvent: async (eventId, etag) => {
      const e = f.events.get(eventId);
      if (e.etag !== etag) throw new GoogleHttpError(412);
      f.deletes++;
      f.events.set(eventId, { id: eventId, status: "cancelled" });
    },
    getSpace: async () => ({
      name: "spaces/opaque",
      meetingCode: "abc-defg-hij",
      meetingUri: "https://meet.google.com/abc-defg-hij",
      config: {
        artifactConfig: { recordingConfig: { autoRecordingGeneration: f.recordingValue ?? "OFF" } },
      },
    }),
    configureRecording: async () => {
      f.recordings++;
      if (f.recordError) throw f.recordError;
      f.recordingValue = f.recordResponse;
      return {
        name: "spaces/opaque",
        config: {
          artifactConfig: { recordingConfig: { autoRecordingGeneration: f.recordResponse } },
        },
      };
    },
  };
  f.repo = repo;
  f.provider = provider;
  f.run = async () => {
    const c = await repo.claim();
    return c ? engine.synchronizeClaim(repo, provider, c, email, workspace) : false;
  };
  f.retry = () => {
    if (job.error_code === "conference_failed") job.conference_generation++;
    job.state = "pending";
  };
  return f;
}
test("Stable event and conference request IDs preserve Google identity across edits", () => {
  assert.match(engine.eventIdFor(id), /^[a-v0-9]{5,1024}$/);
  assert.equal(engine.eventIdFor(id), "eba12345678123442348234123456789abc");
  assert.equal(engine.conferenceRequestFor(id, 0), engine.conferenceRequestFor(id, 0));
  assert.notEqual(engine.conferenceRequestFor(id, 0), engine.conferenceRequestFor(id, 1));
});
test("Local occurrence creates one private event and confirms recording separately", async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal(f.m.sync_status, "synced");
  assert.equal(f.m.recording_status, "configured");
  assert.equal(f.m.join_url, "https://meet.google.com/abc-defg-hij");
  const e = [...f.events.values()][0];
  assert.equal(e.guestsCanSeeOtherGuests, false);
  assert.equal(e.guestsCanModify, false);
  assert.equal(e.guestsCanInviteOthers, false);
  assert.equal(e.start.timeZone, "Africa/Lagos");
  assert.deepEqual(e.reminders, { useDefault: false, overrides: [] });
  assert.deepEqual(
    e.attendees.map((p) => p.email),
    ["admin@enibrand.com", "ceo@enibrand.com"],
  );
  assert(!e.recurrence);
});
test("An accepted insert whose response is lost is recovered without duplicate invites/events", async () => {
  const f = fixture();
  f.insertTimeout = true;
  await f.run();
  assert.equal(f.job.state, "retry");
  f.insertTimeout = false;
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal(f.patches, 0);
  assert.equal(f.events.size, 1);
  assert.equal(f.m.sync_status, "synced");
});
test("Concurrent claims serialize one occurrence and cannot create a second event", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.repo.claim(), f.repo.claim()]);
  assert(a);
  assert.equal(b, null);
  await engine.synchronizeClaim(f.repo, f.provider, a, email, workspace);
  f.retry();
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal(f.patches, 0);
});
test("Delayed conference generation uses durable retries and never shows a premature Join link", async () => {
  const f = fixture();
  f.pending = true;
  await f.run();
  assert.equal(f.m.join_url, null);
  assert.equal(f.job.state, "retry");
  assert.equal(f.recordings, 0);
  assert.equal(
    presentation.meetPresentation(f.m, Date.parse(f.m.starts_at)).label,
    "Preparing meeting",
  );
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal(f.patches, 0);
  f.pending = false;
  f.ready();
  await f.run();
  assert.equal(f.m.recording_status, "configured");
  assert.equal(f.inserts, 1);
});
test("Recording permission failure keeps a usable meeting link and retries only settings", async () => {
  const f = fixture();
  f.recordError = new GoogleHttpError(403);
  await f.run();
  assert.equal(f.m.join_url, "https://meet.google.com/abc-defg-hij");
  assert.equal(f.m.recording_status, "warning");
  assert.equal(f.job.state, "blocked");
  assert.equal(presentation.meetPresentation(f.m, Date.parse(f.m.starts_at)).label, "Ready");
  f.recordError = null;
  f.retry();
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal(f.patches, 0);
  assert.equal(f.m.recording_status, "configured");
});
test("Recording is not configured until the returned Google configuration is ON", async () => {
  const f = fixture();
  f.recordResponse = "OFF";
  await f.run();
  assert.equal(f.m.recording_status, "warning");
  assert(f.m.join_url);
  assert.notEqual(f.m.recording_status, "configured");
});
test("Revoked authorization blocks use with a reconnect-required state", async () => {
  const f = fixture();
  f.provider.getEvent = async () => {
    throw new engine.SyncFailure("reconnect_required");
  };
  await f.run();
  assert.equal(f.m.link_error_code, "reconnect_required");
  assert.equal(f.job.state, "blocked");
  assert.equal(f.inserts, 0);
  assert.equal(
    presentation.meetPresentation(f.m, Date.parse(f.m.starts_at)).label,
    "Reconnect required",
  );
});
test("Newer edits supersede an old claim before its Google write", async () => {
  const f = fixture();
  f.hook = async (action) => {
    if (action === "get") {
      f.hook = null;
      f.edit({ title: "New version" });
    }
  };
  await f.run();
  assert.equal(f.inserts, 0);
  assert.notEqual(f.m.sync_status, "synced");
  await f.run();
  assert.equal([...f.events.values()][0].summary, "New version");
  assert.equal(f.m.version, 2);
});
test("An edit during a remote insert cannot receive stale local readiness; retry converges", async () => {
  const f = fixture();
  f.hook = async (action) => {
    if (action === "insert") {
      f.hook = null;
      f.edit({ title: "Updated during insert" });
    }
  };
  await f.run();
  assert.notEqual(f.m.sync_status, "synced");
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal(f.patches, 1);
  assert.equal([...f.events.values()][0].summary, "Updated during insert");
  assert.equal(f.m.sync_status, "synced");
});
test("Cancellation during create and repeated cancellation never recreate the event", async () => {
  const f = fixture();
  f.hook = async (action) => {
    if (action === "insert") {
      f.hook = null;
      f.edit({ status: "cancelled" });
    }
  };
  await f.run();
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal(f.deletes, 1);
  assert.equal(f.m.join_url, null);
  f.retry();
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal(f.deletes, 1);
  assert.equal(f.m.sync_status, "synced");
});
test("Cancelled-before-create occurrences never send Google invitations", async () => {
  const f = fixture();
  f.edit({ status: "cancelled" });
  await f.run();
  assert.equal(f.inserts, 0);
  assert.equal(f.m.sync_status, "synced");
});
test("An ambiguous cancellation 404 stays durable and removes a late-arriving event", async () => {
  const f = fixture();
  await f.run();
  const event = structuredClone([...f.events.values()][0]);
  f.events.clear();
  f.edit({ status: "cancelled" });
  await f.run();
  assert.equal(f.job.state, "retry");
  assert.equal(f.m.sync_status, "pending_cancel");
  assert.equal(f.m.join_url, null);
  f.events.set(event.id, event);
  await f.run();
  assert.equal(f.job.state, "done");
  assert.equal(f.deletes, 1);
  assert.equal(f.inserts, 1);
});
test("A superseded lease cannot write even when the occurrence version is unchanged", async () => {
  const f = fixture(),
    old = await f.repo.claim();
  f.job.lease_token = "replacement-lease";
  f.job.state = "pending";
  await engine.synchronizeClaim(f.repo, f.provider, old, email, workspace);
  assert.equal(f.inserts, 0);
  await f.run();
  assert.equal(f.inserts, 1);
});
test("Definitive conference failure rotates only the conference request on explicit retry", async () => {
  const f = fixture();
  f.pending = true;
  await f.run();
  const e = [...f.events.values()][0];
  e.conferenceData.createRequest.status.statusCode = "failure";
  f.pending = false;
  await f.run();
  assert.equal(f.job.error_code, "conference_failed");
  assert.equal(f.inserts, 1);
  f.retry();
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal(f.patches, 1);
  assert.equal(e.conferenceData.createRequest.requestId, engine.conferenceRequestFor(id, 1));
  assert.equal(f.m.sync_status, "synced");
});
test("An invalid/unverified participant stops all Google creation", async () => {
  const f = fixture();
  f.people.pop();
  await f.run();
  assert.equal(f.inserts, 0);
  assert.equal(f.m.link_error_code, "attendees_invalid");
});
test("A different organizer or foreign event marker cannot be modified or deleted", async () => {
  let f = fixture();
  f.m.provider_calendar_id = "other@enibrand.com";
  await f.run();
  assert.equal(f.m.link_error_code, "organizer_changed");
  f = fixture();
  f.events.set(engine.eventIdFor(id), {
    id: engine.eventIdFor(id),
    etag: "foreign",
    extendedProperties: { private: { ebaOccurrence: "someone-else" } },
  });
  await f.run();
  assert.equal(f.patches, 0);
  assert.equal(f.m.link_error_code, "conflict");
  f.edit({ status: "cancelled" });
  await f.run();
  assert.equal(f.deletes, 0);
});
test("412 conflicts retry by rereading and keep the same event/conference identities", async () => {
  const f = fixture();
  await f.run();
  f.edit({ title: "Next title" });
  const real = f.provider.patchEvent;
  f.provider.patchEvent = async () => {
    throw new GoogleHttpError(412);
  };
  await f.run();
  assert.equal(f.job.state, "retry");
  f.provider.patchEvent = real;
  await f.run();
  assert.equal(f.inserts, 1);
  assert.equal([...f.events.values()][0].summary, "Next title");
});
test("UI accepts only exact HTTPS Meet URLs and never joins a cancelled occurrence", () => {
  for (const url of [
    "https://evil.invalid/abc-defg-hij",
    "https://meet.google.com.evil.invalid/abc-defg-hij",
    "javascript:alert(1)",
    "https://meet.google.com/abc-defg-hij?secret=1",
  ])
    assert(!presentation.validMeetUrl(url));
  const f = fixture();
  assert.equal(
    presentation.meetPresentation({
      ...f.m,
      join_url: "https://meet.google.com/abc-defg-hij",
      status: "cancelled",
    }).url,
    null,
  );
});
test("Google REST writes use If-Match, sendUpdates, private guest flags and narrow recording mask", async () => {
  const oldFetch = global.fetch,
    calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: "fixture", name: "spaces/opaque" }), { status: 200 });
  };
  try {
    const p = new CalendarGoogleProvider(async () => "fixture-token");
    await p.insertEvent({ guestsCanSeeOtherGuests: false });
    await p.patchEvent("id", "etag", { summary: "Changed" });
    await p.deleteEvent("id", "etag");
    await p.configureRecording("spaces/opaque");
    assert(calls[0].url.includes("conferenceDataVersion=1&sendUpdates=all"));
    assert.equal(calls[1].options.headers["If-Match"], "etag");
    assert.equal(calls[2].options.headers["If-Match"], "etag");
    assert(
      calls[3].url.endsWith(
        "updateMask=config.artifactConfig.recordingConfig.autoRecordingGeneration",
      ),
    );
    assert(!calls.some((c) => c.url.includes("fixture-token")));
  } finally {
    global.fetch = oldFetch;
  }
});

test("Retry API denies invitees, outsiders, signed-out and cross-origin callers", async () => {
  let who = "invitee",
    runs = 0;
  const original = Module._load;
  const stub = {
    calendarHeaders: { "Cache-Control": "private, no-store" },
    calendarAuth: async () => (who ? { user: { id: who }, client: {} } : null),
    findMeeting: async () => ({ data: who === "outsider" ? null : { organizer_id: "owner" } }),
  };
  let route;
  try {
    Module._load = function (name, ...args) {
      if (name === "../../../server") return stub;
      if (name.includes("calendar-google/call-ending"))
        return { runCallEnding: async () => ({ available: true, processed: 0, ended: 0 }) };
      if (name.includes("calendar-google/import"))
        return { runGoogleImport: async () => ({ available: true, imported: 0 }) };
      if (name.includes("calendar-reminders/server"))
        return {
          runCalendarReminders: async () => ({
            available: true,
            delivered: 0,
            skipped: 0,
            checked: 0,
            group_delivery: "pending_private_groups",
          }),
        };
      if (name.includes("calendar-google/worker"))
        return {
          retryOccurrence: async () => true,
          runCalendarSync: async () => {
            runs++;
          },
        };
      return original.call(this, name, ...args);
    };
    route = require(root + "/src/app/dashboard/calendar/api/[id]/sync/route.ts");
  } finally {
    Module._load = original;
  }
  const request = (origin) =>
      new Request("http://localhost:3000/dashboard/calendar/api/" + id + "/sync", {
        method: "POST",
        headers: { origin: origin ?? "http://localhost:3000" },
      }),
    params = { params: Promise.resolve({ id }) };
  assert.equal((await route.POST(request(), params)).status, 404);
  who = "outsider";
  assert.equal((await route.POST(request(), params)).status, 404);
  who = null;
  assert.equal((await route.POST(request(), params)).status, 401);
  who = "owner";
  assert.equal((await route.POST(request("https://attacker.invalid"), params)).status, 403);
  assert.equal(runs, 0);
  assert.equal((await route.POST(request(), params)).status, 200);
  assert.equal(runs, 1);
});
test("Weekly exceptions map to independent stable events; remaining edits and cancels preserve identities", async () => {
  const days = [fixture(), fixture(), fixture()];
  for (let i = 0; i < days.length; i++) {
    const f = days[i];
    f.m.id = id.slice(0, -1) + i;
    f.job.occurrence_id = f.m.id;
    f.m.ordinal = i;
    f.m.starts_at = new Date(+new Date(f.m.starts_at) + i * 7 * 86400000).toISOString();
    f.m.ends_at = new Date(+new Date(f.m.ends_at) + i * 7 * 86400000).toISOString();
    await f.run();
  }
  const identities = days.map((f) => f.m.provider_event_id);
  assert.equal(new Set(identities).size, 3);
  assert.equal(
    new Set(days.map((f) => [...f.events.values()][0].conferenceData.createRequest.requestId)).size,
    3,
  );
  days[1].edit({
    title: "One occurrence moved",
    starts_at: "2030-11-26T11:00:00Z",
    ends_at: "2030-11-26T12:00:00Z",
  });
  await days[1].run();
  assert.equal(days[0].patches, 0);
  assert.equal(days[2].patches, 0);
  for (const f of days.slice(1)) {
    f.edit({ title: "Remaining occurrences" });
    await f.run();
    assert.equal(f.inserts, 1);
  }
  days[1].edit({ status: "cancelled" });
  await days[1].run();
  assert.equal(days[2].deletes, 0);
  days[2].edit({ status: "cancelled" });
  await days[2].run();
  assert.deepEqual(
    days.map((f) => f.m.provider_event_id),
    identities,
  );
  assert.equal(days[0].deletes, 0);
});
test("The real worker refreshes an expired access token exactly once after Google 401", async () => {
  const f = fixture();
  let refreshes = 0,
    first = true,
    claim;
  const db = {
    rpc: async (_name, args) => {
      let data;
      if (args.p_action === "claim") {
        claim = await f.repo.claim();
        data = claim;
      } else if (args.p_action === "assert") data = await f.repo.current(claim);
      else if (args.p_action === "bind")
        data = await f.repo.bind(
          claim,
          args.p_data.email,
          args.p_data.event_id,
          args.p_data.create_attempt,
        );
      else if (args.p_action === "finish") data = await f.repo.finish(claim, args.p_data);
      else if (_name === "calendar_google_people") data = f.people;
      return { data, error: null };
    },
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      single: async () => ({ data: { enabled: true, version: 1, email } }),
    }),
  };
  class FakeGoogle {
    constructor(access) {
      for (const name of Object.keys(f.provider))
        this[name] = async (...args) => {
          await access();
          if (name === "getEvent" && first) {
            first = false;
            throw new GoogleHttpError(401);
          }
          return f.provider[name](...args);
        };
    }
  }
  const original = Module._load;
  let worker;
  const filename = root + "/src/lib/calendar-google/worker.ts";
  delete require.cache[filename];
  try {
    Module._load = function (name, ...args) {
      if (name === "server-only") return {};
      if (name === "../../app/dashboard/calendar/server") return { calendarAdmin: () => db };
      if (name === "../google-organizer/server")
        return {
          organizerAccess: async () => {
            refreshes++;
            return { accessToken: "fixture-token-" + refreshes, version: 1 };
          },
          connectionStatus: async () => ({ state: "connected" }),
          ConnectionFailure: class extends Error {},
        };
      if (name === "../google-organizer/provider")
        return { ProviderFailure: class extends Error {} };
      if (
        name === "./provider" &&
        path.normalize(args[0]?.filename ?? "") === path.normalize(filename)
      )
        return {
          ...require(root + "/src/lib/calendar-google/provider.ts"),
          CalendarGoogleProvider: FakeGoogle,
        };
      return original.call(this, name, ...args);
    };
    worker = require(filename);
  } finally {
    Module._load = original;
  }
  const oldEmail = process.env.GOOGLE_ORGANIZER_EMAIL;
  process.env.GOOGLE_ORGANIZER_EMAIL = email;
  try {
    await worker.runCalendarSync(id);
    assert.equal(refreshes, 2);
    assert.equal(f.inserts, 1);
    assert.equal(f.m.recording_status, "configured");
  } finally {
    if (oldEmail === undefined) delete process.env.GOOGLE_ORGANIZER_EMAIL;
    else process.env.GOOGLE_ORGANIZER_EMAIL = oldEmail;
  }
});
test("Cron processing requires its own bearer secret, never staff cookies alone", async () => {
  const original = Module._load;
  let route,
    runs = 0;
  try {
    Module._load = function (name, ...args) {
      if (name.includes("calendar-google/call-ending"))
        return { runCallEnding: async () => ({ available: true, processed: 0, ended: 0 }) };
      if (name.includes("calendar-google/import"))
        return { runGoogleImport: async () => ({ available: true, imported: 0 }) };
      if (name.includes("calendar-reminders/server"))
        return {
          runCalendarReminders: async () => ({
            available: true,
            delivered: 0,
            skipped: 0,
            checked: 0,
            group_delivery: "pending_private_groups",
          }),
        };
      if (name.includes("calendar-google/worker"))
        return {
          runCalendarSync: async () => {
            runs++;
            return { processed: 1, completed: 1 };
          },
        };
      if (name.includes("google-organizer/server"))
        return { privateHeaders: { "Cache-Control": "private, no-store" } };
      return original.call(this, name, ...args);
    };
    route = require(root + "/src/app/api/calendar/sync/route.ts");
  } finally {
    Module._load = original;
  }
  const old = process.env.CALENDAR_SYNC_SECRET;
  process.env.CALENDAR_SYNC_SECRET = "fixture-worker-secret-32-characters-minimum";
  try {
    for (const headers of [
      {},
      { cookie: "staff-session=fixture" },
      { authorization: "Bearer wrong" },
    ])
      assert.equal(
        (
          await route.POST(
            new Request("http://localhost:3000/api/calendar/sync", { method: "POST", headers }),
          )
        ).status,
        403,
      );
    assert.equal(runs, 0);
    const response = await route.POST(
      new Request("http://localhost:3000/api/calendar/sync", {
        method: "POST",
        headers: { authorization: "Bearer " + process.env.CALENDAR_SYNC_SECRET },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      processed: 1,
      completed: 1,
      google_import: { available: true, imported: 0 },
      call_ending: { available: true, processed: 0, ended: 0 },
      reminders: {
        available: true,
        delivered: 0,
        skipped: 0,
        checked: 0,
        group_delivery: "pending_private_groups",
      },
    });
    assert.equal(runs, 1);
  } finally {
    if (old === undefined) delete process.env.CALENDAR_SYNC_SECRET;
    else process.env.CALENDAR_SYNC_SECRET = old;
  }
});
