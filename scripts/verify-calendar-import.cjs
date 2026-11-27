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
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      f,
    );
function load(file, stubs) {
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
const { incomingEvent } = require("../src/lib/calendar-google/import-model.ts"),
  email = "google-organizer@example.test";
const event = () => ({
  id: "google-fixture",
  organizer: { email },
  summary: "HOD and Leadership meeting",
  start: { dateTime: "2030-11-20T12:00:00+01:00" },
  end: { dateTime: "2030-11-20T13:00:00+01:00" },
  attendees: [
    { email: "ceo@enibrand.com" },
    { email: "external@example.com" },
    { email: "declined@enibrand.com", responseStatus: "declined" },
  ],
  hangoutLink: "https://meet.google.com/abc-defg-hij",
});
test("Owned timed meeting normalizes title, instant, exact Meet URL and nondeclined addresses", () => {
  const incoming = incomingEvent(event(), email);
  assert.equal(incoming.title, "HOD and Leadership meeting");
  assert.equal(incoming.start, event().start.dateTime);
  assert.equal(incoming.url, event().hangoutLink);
  assert.deepEqual(incoming.attendees, ["ceo@enibrand.com", "external@example.com"]);
});
test("Native EBA events never loop back into imported records", () => {
  assert.equal(
    incomingEvent(
      { ...event(), extendedProperties: { private: { ebaOccurrence: "fixture" } } },
      email,
    ),
    null,
  );
});
test("External organizer events are ignored; incomplete owned events fail closed", () => {
  assert.equal(
    incomingEvent({ ...event(), organizer: { email: "other@example.com" } }, email),
    null,
  );
  for (const change of [
    { attendeesOmitted: true },
    { start: { date: "2030-11-20" } },
    { end: { dateTime: "2030-11-22T13:00:00+01:00" } },
    { start: { dateTime: "invalid" } },
  ])
    assert.deepEqual(incomingEvent({ ...event(), ...change }, email), {
      id: "google-fixture",
      cancelled: true,
    });
});
test("Cancellations can have minimal fields; unsafe links never produce Join", () => {
  assert.deepEqual(incomingEvent({ id: "deleted", status: "cancelled" }, email), {
    id: "deleted",
    cancelled: true,
  });
  assert.equal(
    incomingEvent({ ...event(), hangoutLink: "https://attacker.invalid" }, email).url,
    null,
  );
});
test("Real provider lists primary instances with pagination using GET only", async () => {
  const { CalendarGoogleProvider } = load("src/lib/calendar-google/provider.ts", {
      "server-only": {},
    }),
    old = global.fetch;
  global.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/calendar/v3/calendars/primary/events");
    assert.equal(parsed.searchParams.get("pageToken"), "next-fixture");
    assert.equal(parsed.searchParams.get("singleEvents"), "true");
    assert.equal(parsed.searchParams.get("showDeleted"), "true");
    assert.equal(options.method, "GET");
    assert(!options.body);
    return Response.json({ items: [event()], nextPageToken: "page-two" });
  };
  try {
    const result = await new CalendarGoogleProvider(
      async () => "fixture-token",
      Date.now() + 1000,
    ).listEvents("2030-11-01T00:00:00Z", "2030-12-01T00:00:00Z", "next-fixture");
    assert.equal(result.nextPageToken, "page-two");
  } finally {
    global.fetch = old;
  }
});
test("Real importer awaits atomic finish and rechecks known deleted events outside list window", async () => {
  const old = process.env.GOOGLE_ORGANIZER_EMAIL,
    oldOwner = process.env.GOOGLE_IMPORT_OWNER_EMAIL;
  process.env.GOOGLE_ORGANIZER_EMAIL = email;
  process.env.GOOGLE_IMPORT_OWNER_EMAIL = "fixture-google-organizer@example.test";
  const calls = [];
  let fail = false;
  class Provider {
    async listEvents() {
      return { items: [event()], nextPageToken: "next" };
    }
    async getEvent() {
      return null;
    }
  }
  const worker = load("src/lib/calendar-google/import.ts", {
    "server-only": {},
    "../../app/dashboard/calendar/server": {
      calendarAdmin: () => ({
        rpc: (name, args) => {
          if (name === "calendar_required_participant_emails")
            return Promise.resolve({ data: [], error: null });
          if (name === "calendar_google_invitation_deltas")
            return Promise.resolve({ data: {}, error: null });
          return {
            abortSignal: async () => {
              calls.push(args);
              if (args.p_action === "claim")
                return {
                  data: { lease: "fixture", from: "from", to: "to", check: "deleted" },
                  error: null,
                };
              if (args.p_action === "finish" && fail) return { error: { code: "fixture" } };
              return { data: { imported: 1 }, error: null };
            },
          };
        },
      }),
    },
    "../google-organizer/server": { organizerAccess: async () => ({ accessToken: "fixture" }) },
    "./provider": { CalendarGoogleProvider: Provider },
  });
  try {
    assert.deepEqual(await worker.runGoogleImport(), {
      available: true,
      imported: 1,
      unsupported_external: 0,
      invitations_pending: 0,
    });
    assert.deepEqual(
      calls.map((c) => c.p_action),
      ["claim", "finish"],
    );
    assert(calls.every((c) => c.p_data.owner_email === "fixture-google-organizer@example.test"));
    assert(calls[1].p_data.events.some((e) => e.id === "deleted" && e.cancelled));
    calls.length = 0;
    fail = true;
    assert.equal((await worker.runGoogleImport()).available, false);
    assert.deepEqual(
      calls.map((c) => c.p_action),
      ["claim", "finish", "reset"],
    );
  } finally {
    if (old === undefined) delete process.env.GOOGLE_ORGANIZER_EMAIL;
    else process.env.GOOGLE_ORGANIZER_EMAIL = old;
    if (oldOwner === undefined) delete process.env.GOOGLE_IMPORT_OWNER_EMAIL;
    else process.env.GOOGLE_IMPORT_OWNER_EMAIL = oldOwner;
  }
});
test("Actual detail dialog keeps imported organizer read-only and suppresses retry", () => {
  const React = require("react"),
    { renderToStaticMarkup } = require("react-dom/server");
  require.extensions[".css"] = () => {};
  const { MeetingDialog } = load("src/app/dashboard/calendar/meeting-dialog.tsx", {
    "./meet-status": {
      MeetStatus: ({ organizer }) =>
        React.createElement("span", null, organizer ? "Retry visible" : "No retry"),
    },
  });
  const meeting = {
    id: "fixture",
    source: "google",
    organizer_id: "admin",
    title: "Imported meeting",
    starts_at: "2030-11-20T11:00:00Z",
    ends_at: "2030-11-20T12:00:00Z",
    frequency: "once",
    status: "scheduled",
    attendee_ids: [],
  };
  const html = renderToStaticMarkup(
    React.createElement(MeetingDialog, {
      meeting,
      userId: "admin",
      directory: { people: [], requiredParticipants: [], departments: [], ready: true },
      onClose() {},
      onSaved() {},
    }),
  );
  assert.match(html, /Imported from Google Calendar/);
  assert(!html.includes("Edit meeting"));
  assert(!html.includes("Cancel meeting"));
  assert.match(html, /No retry/);
});
test("SQL contract isolates source, validates active accounts, leases and no outbound jobs", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20261117120000_google_calendar_import.sql"),
    "utf8",
  );
  for (const pattern of [
    /enable row level security/i,
    /revoke all on public.calendar_google_import_state from public,anon,authenticated/,
    /calendar_reminder_account_active\(u.id\)/,
    /if found and o.source<>'google'/,
    /if new.source='google'/,
    /st.lease is distinct from/,
    /Edit or cancel this meeting in Google Calendar/,
    /Imported meetings cannot be exported/,
  ])
    assert.match(sql, pattern);
});
test("Real mutation and retry endpoints reject imported organizer changes before any write", async () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  let writes = 0;
  const server = {
    calendarHeaders: {},
    calendarAuth: async () => ({ client: {}, user: { id: "admin" } }),
    calendarAdmin: () => ({
      rpc: async () => {
        writes++;
        throw Error("Unexpected write");
      },
    }),
    findMeeting: async () => ({
      data: { id, organizer_id: "admin", source: "google" },
      error: null,
    }),
  };
  const mutation = load("src/app/dashboard/calendar/api/route.ts", { "../server": server });
  const retry = load("src/app/dashboard/calendar/api/[id]/sync/route.ts", {
    "../../../server": server,
    "../../../../../../lib/calendar-google/worker": {
      retryOccurrence: async () => {
        writes++;
      },
      runCalendarSync: async () => {
        writes++;
      },
    },
  });
  const request = () =>
    new Request("http://localhost:3000/dashboard/calendar/api", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: JSON.stringify({ id, requestId: id, command: "cancel", scope: "one", version: 1 }),
    });
  assert.equal((await mutation.POST(request())).status, 409);
  assert.equal((await retry.POST(request(), { params: Promise.resolve({ id }) })).status, 409);
  assert.equal(writes, 0);
});
test("Verified owner forward migration requires explicit Admin and successful current-connection proof", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20261117133000_google_import_verified_owner.sql"),
    "utf8",
  );
  for (const pattern of [
    /nullif\(p_owner_email,''\) is null/,
    /u.email=p_owner_email and m.role='admin'/,
    /calendar_reminder_account_active\(u.id\)/,
    /s.admin_id=person/,
    /s.consumed_at is not null and s.saved_at=c.connected_at/,
    /s.version<c.version/,
    /v.owner_id=person and v.google_email=c.email and v.google_subject=c.subject and v.connected_at=c.connected_at/,
    /st.owner_id is distinct from resolved_owner/,
    /o.organizer_id<>resolved_owner/,
    /revoke all on public.calendar_google_import_owners from public,anon,authenticated/,
  ])
    assert.match(sql, pattern);
  assert(
    !/(?:update|insert into|alter table) (?:auth\.users|public\.staff_memberships|public\.google_organizer_connection)\b/i.test(
      sql,
    ),
  );
  assert(!/create or replace function public.calendar_reminder_account_active/.test(sql));
});
test("Strict default import mode sends no inferred owner mapping", async () => {
  const oldOwner = process.env.GOOGLE_IMPORT_OWNER_EMAIL,
    oldGoogle = process.env.GOOGLE_ORGANIZER_EMAIL;
  delete process.env.GOOGLE_IMPORT_OWNER_EMAIL;
  process.env.GOOGLE_ORGANIZER_EMAIL = email;
  const worker = load("src/lib/calendar-google/import.ts", {
    "server-only": {},
    "../google-organizer/server": {
      organizerAccess: async () => {
        throw Error("Unexpected Google call");
      },
    },
    "../../app/dashboard/calendar/server": {
      calendarAdmin: () => ({
        rpc: (name, args) => {
          if (name === "calendar_required_participant_emails")
            return Promise.resolve({ data: [], error: null });
          return {
            abortSignal: async () => {
              assert(!Object.hasOwn(args.p_data, "owner_email"));
              return { data: null, error: null };
            },
          };
        },
      }),
    },
  });
  try {
    assert.deepEqual(await worker.runGoogleImport(), {
      available: true,
      imported: 0,
      unsupported_external: 0,
      invitations_pending: 0,
    });
  } finally {
    if (oldOwner === undefined) delete process.env.GOOGLE_IMPORT_OWNER_EMAIL;
    else process.env.GOOGLE_IMPORT_OWNER_EMAIL = oldOwner;
    if (oldGoogle === undefined) delete process.env.GOOGLE_ORGANIZER_EMAIL;
    else process.env.GOOGLE_ORGANIZER_EMAIL = oldGoogle;
  }
});
