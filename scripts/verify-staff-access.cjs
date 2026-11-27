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
  const f = path.join(root, file),
    previous = Module._load;
  delete require.cache[f];
  try {
    Module._load = function (name, ...args) {
      return Object.hasOwn(stubs, name) ? stubs[name] : previous.call(this, name, ...args);
    };
    return require(f);
  } finally {
    Module._load = previous;
  }
}
const model = require("../src/lib/staff-access/model.ts");
const id = "12345678-1234-4234-8234-123456789abc",
  email = "person@enibrand.com",
  token = "a".repeat(64);
test("Company emails normalize exactly and external domains, malformed addresses and role escalation fail", () => {
  assert.equal(model.companyEmail(" Person@ENIBRAND.COM "), email);
  for (const value of [
    "person@enibrand.com.evil",
    "person@other.com",
    "person@@enibrand.com",
    "p q@enibrand.com",
    "p@sub.enibrand.com",
    "@enibrand.com",
  ])
    assert.throws(() => model.companyEmail(value));
  for (const role of ["ceo", "admin", "Admin", "__proto__"])
    assert.throws(() => model.assignment({ name: "Person", role, department: "graphics" }));
  assert.throws(() => model.assignment({ name: "Person", role: "staff", department: "toString" }));
  assert.equal(
    model.assignment({ name: " Person ", role: "hod", department: "communications" }).role,
    "hod",
  );
});
function serviceFixture() {
  const calls = [];
  let authFailure = false;
  const db = {
    rpc: (name, args) => ({
      abortSignal: async () => {
        calls.push({ name, args });
        return {
          data: args.p_action === "invite" ? { id, existing_account: false } : { ok: true },
        };
      },
    }),
    auth: {
      admin: {
        generateLink: async (input) => {
          calls.push({ generate: input });
          return authFailure
            ? { error: true, data: {} }
            : { data: { user: { id, email }, properties: { hashed_token: "fixture-auth-hash" } } };
        },
      },
    },
  };
  const before = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SECRET_KEY,
    app: process.env.EBA_APP_URL,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.invalid";
  process.env.SUPABASE_SECRET_KEY = "fixture-server";
  process.env.EBA_APP_URL = "http://localhost:3000";
  const server = load("src/lib/staff-access/server.ts", {
    "server-only": {},
    "@supabase/supabase-js": { createClient: () => db },
    "../staff-auth": {},
  });
  return {
    calls,
    server,
    fail: () => (authFailure = true),
    restore() {
      for (const [key, value] of Object.entries({
        NEXT_PUBLIC_SUPABASE_URL: before.url,
        SUPABASE_SECRET_KEY: before.key,
        EBA_APP_URL: before.app,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
test("Actual invite service reserves a hash, binds the returned identity, and honestly returns a fragment-only copy link", async () => {
  const f = serviceFixture();
  try {
    const result = await f.server.manageStaff("invite", "admin", {
      email: " Person@ENIBRAND.COM ",
      name: "Person",
      role: "staff",
      department: "graphics",
      requestId: id,
    });
    assert.equal(result.delivery, "not_configured");
    assert.match(result.message, /No email|no email|Email delivery is not configured/);
    const link = new URL(result.link),
      parts = new URLSearchParams(link.hash.slice(1)),
      raw = parts.get("invite");
    assert.equal(link.search, "");
    assert.equal(link.pathname, "/staff/invitation");
    assert.match(raw, /^[a-f0-9]{64}$/);
    assert.equal(f.calls[0].args.p_data.token_hash, f.server.hashInvite(raw));
    assert(!JSON.stringify(f.calls).includes(raw));
    assert.deepEqual(f.calls[1].generate, { type: "invite", email });
    assert.equal(f.calls[2].args.p_action, "bind");
    assert.equal(f.calls[2].args.p_data.account_id, id);
  } finally {
    f.restore();
  }
});
test("Actual service rejects privileged assignments and unconfirmed disable actions before database writes", async () => {
  const f = serviceFixture();
  try {
    await assert.rejects(() =>
      f.server.manageStaff("invite", "admin", {
        email,
        name: "Person",
        role: "ceo",
        department: "graphics",
        requestId: id,
      }),
    );
    await assert.rejects(() => f.server.manageStaff("deactivate", "admin", { id, version: 1 }));
    await assert.rejects(() => f.server.manageStaff("reactivate", "admin", { id, version: 0 }));
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});
test("Auth generation failure marks invitation failed, never claims email delivery, and never deletes an Auth user", async () => {
  const f = serviceFixture();
  f.fail();
  try {
    await assert.rejects(
      () =>
        f.server.manageStaff("invite", "admin", {
          email,
          name: "Person",
          role: "hod",
          department: "marketing",
          requestId: id,
        }),
      /No email was sent/,
    );
    assert.equal(f.calls.at(-1).args.p_action, "fail");
  } finally {
    f.restore();
  }
});
test("Real Settings HTTP handlers allow CEO directory reads but deny CEO writes, inactive actors and cross-origin mutations", async () => {
  let role = "CEO",
    active = true,
    origin = true,
    writes = 0;
  const route = load("src/app/dashboard/settings/staff/route.ts", {
    "../../../../lib/staff-access/server": {
      staffHeaders: {},
      trustedOrigin: () => origin,
      staffActor: async () => (active ? { id, role } : null),
      staffRPC: async () => ({ members: [], invitations: [], audit: [] }),
      manageStaff: async () => {
        writes++;
        return { message: "fixture" };
      },
    },
  });
  const post = () =>
    route.POST(
      new Request("http://localhost:3000/dashboard/settings/staff", {
        method: "POST",
        body: JSON.stringify({ action: "invite" }),
      }),
    );
  assert.equal((await route.GET()).status, 200);
  assert.equal((await post()).status, 403);
  role = "Admin";
  assert.equal((await post()).status, 200);
  active = false;
  assert.equal((await post()).status, 403);
  assert.equal((await route.GET()).status, 403);
  active = true;
  origin = false;
  assert.equal((await post()).status, 403);
  assert.equal(writes, 1);
});
function acceptanceFixture() {
  const calls = [];
  let state = "pending",
    now = 1000,
    mismatch = false,
    member = false;
  const client = {
    auth: {
      verifyOtp: async () => {
        calls.push("verify");
        return { data: { user: { id, email, email_confirmed_at: "fixture" } } };
      },
      getUser: async () => ({ data: { user: { id, email } } }),
      updateUser: async () => {
        calls.push("password");
        return { error: null };
      },
    },
  };
  const route = load("src/app/staff/invitation/api/route.ts", {
    "../../../../lib/staff-auth": {
      createSessionClient: async (cookie) => {
        assert.equal(cookie, "eba-staff-invitation");
        return client;
      },
      clearStaffSession: async (_c, cookie) => {
        assert.equal(cookie, "eba-staff-invitation");
        calls.push("clear");
      },
    },
    "../../../../lib/staff-access/server": {
      staffHeaders: {},
      trustedOrigin: () => true,
      hashInvite: () => "fixture-hash",
      staffRPC: async (action, actor) => {
        calls.push(action);
        if (state !== "pending" || now >= 2000) throw Error("Unavailable");
        if (action === "inspect") return { new_account: true };
        assert.equal(actor, id);
        if (mismatch) throw Error("Identity mismatch");
        if (action === "accept") {
          state = "accepted";
          member = true;
          return { ok: true };
        }
        return { ok: true };
      },
    },
  });
  return {
    calls,
    route,
    get member() {
      return member;
    },
    set state(v) {
      state = v;
    },
    set now(v) {
      now = v;
    },
    set mismatch(v) {
      mismatch = v;
    },
    post: () =>
      route.POST(
        new Request("http://localhost:3000/staff/invitation/api", {
          method: "POST",
          body: JSON.stringify({
            invite: token,
            token_hash: "fixture-auth-hash",
            type: "invite",
            password: "fixture-password-long",
          }),
        }),
      ),
  };
}
test("Acceptance uses an isolated Auth session, verifies identity before password/membership writes, and gives role-scoped dashboard guidance", async () => {
  const f = acceptanceFixture(),
    r = await f.post();
  assert.equal(r.status, 200);
  assert(f.member);
  assert.match((await r.json()).message, /active role and department assignment/);
  assert.deepEqual(f.calls, [
    "inspect",
    "verify",
    "verify_identity",
    "password",
    "accept",
    "clear",
  ]);
  assert.equal((await f.post()).status, 409);
});
test("Injected invitation-clock expiry, revocation and identity mismatch deny membership and password changes", async () => {
  for (const scenario of ["expired", "revoked", "mismatch"]) {
    const f = acceptanceFixture();
    if (scenario === "expired") f.now = 2000;
    if (scenario === "revoked") f.state = "revoked";
    if (scenario === "mismatch") f.mismatch = true;
    assert.equal((await f.post()).status, 409);
    assert(!f.member);
    assert(!f.calls.includes("password"));
    assert.equal(f.calls.at(-1), "clear");
  }
});
test("Existing staff sign-in role gate still rejects inactive Employee/HOD and ignores editable metadata", async () => {
  const { getStaffRole } = load("src/lib/staff-auth.ts", {
    "next/headers": {},
    "./supabase-client": {},
  });
  let result = { role: "staff" };
  const filters = [];
  const q = {
    select: () => q,
    eq: (k, v) => {
      filters.push([k, v]);
      return q;
    },
    maybeSingle: async () => ({ data: result }),
  };
  const client = { from: () => q },
    user = { id, email, raw_user_meta_data: { role: "admin" } };
  assert.equal(await getStaffRole(client, user), null);
  result = { role: "hod" };
  assert.equal(await getStaffRole(client, user), null);
  result = { role: "admin" };
  assert.equal(await getStaffRole(client, user), "Admin");
  result = null;
  assert.equal(await getStaffRole(client, user), null);
  assert(filters.some(([k, v]) => k === "status" && v === "active"));
});
test("SQL contracts fence concurrency, duplicate invitations, self/last Admin and privileged changes without historical deletions", () => {
  const sql = fs.readFileSync(
    root + "/supabase/migrations/20261119130000_staff_access.sql",
    "utf8",
  );
  for (const p of [
    /pg_advisory_xact_lock/,
    /access_version is distinct from/,
    /target=p_actor/,
    /Cannot remove last active Admin/,
    /member.role in\('ceo','admin'\)/,
    /role in\('ceo','admin','staff','hod'\)/,
    /staff_access_one_pending_email/,
    /invite.status<>'pending'/,
    /invite.expires_at<=clock_timestamp\(\)/,
    /u.id is distinct from invite.account_id/,
    /u.email_confirmed_at is null/,
    /client_portal_access/,
    /revoke all on function public.staff_access_control.*from public,anon,authenticated/,
  ])
    assert.match(sql, p);
  assert(
    !/delete from (auth\.|public\.(staff_memberships|connect_messages|approval_requests|department_plans))/.test(
      sql,
    ),
  );
  assert(!/select \* into u from auth.users/.test(sql));
  const diag = fs.readFileSync(root + "/supabase/checks/staff_access_diagnostic.sql", "utf8");
  assert.match(diag, /begin transaction read only/);
  assert.match(diag, /union all select \* from privacy/);
  assert.match(diag, /case when passed then 'PASS' else 'FAIL'/);
});

test("Forward repair qualifies the actual ambiguous audit target without rewriting applied migrations or changing grants", () => {
  const migration = fs.readFileSync(
    root + "/supabase/migrations/20261119160000_staff_directory_target_ambiguity.sql",
    "utf8",
  );
  assert.match(migration, /select audit.id,audit.actor,audit.action,audit.target,audit.created_at/);
  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /execute replace\(definition,old_projection,new_projection\)/);
  assert.match(migration, /Expected audit projection not found/);
  assert(!/grant |security definer|variable_conflict use_/i.test(migration));
  const focused = fs.readFileSync(
    root + "/supabase/checks/staff_directory_verification.sql",
    "utf8",
  );
  assert.match(focused, /begin transaction read only/);
  assert.match(focused, /set local role service_role/);
  assert.match(focused, /staff_access_control\('directory',user_id,'\{\}'::jsonb\)/);
  assert.match(focused, /rollback;/);
});

test("Directory errors retain only safe server diagnostic categories; response parsing rejects malformed payloads", () => {
  const {
    staffFailure,
    staffFailureMessage,
    directoryResponse,
  } = require("../src/lib/staff-access/diagnostics.ts");
  const classified = staffFailure("directory", {
    code: "42702",
    message: "PRIVATE_RECORD token=PRIVATE_TOKEN",
    details: "PRIVATE_SECRET",
    hint: "PRIVATE_EMAIL",
  });
  assert.deepEqual(classified, {
    event: "staff_access_rpc",
    action: "directory",
    code: "42702",
    category: "ambiguous_sql_reference",
  });
  assert(!JSON.stringify(classified).includes("PRIVATE"));
  assert.equal(staffFailure("SECRET_ACTION", { code: "42501" }).action, "unknown");
  assert.equal(
    staffFailure("directory", { code: "P0001", message: "Active management account required" })
      .category,
    "management_authorization",
  );
  assert.equal(staffFailure("directory", { code: "PGRST202" }).category, "rpc_signature");
  const missingDelete = staffFailureMessage("delete_member", {
    code: "PGRST202",
    message: "PRIVATE SQL DETAIL token=PRIVATE_SECRET",
  });
  assert.match(missingDelete, /deletion migration and its service-role grant/);
  assert(!missingDelete.includes("PRIVATE"));
  assert(!directoryResponse(null));
  assert(!directoryResponse({ members: [], invitations: [], audit: [] }));
  assert(directoryResponse({ members: [], invitations: [], audit: [], truncated: false }));
});

test("Delete confirmation keeps server failures visible inside the open modal", () => {
  const ui = fs.readFileSync(root + "/src/app/dashboard/settings/staff-access-card.tsx", "utf8");
  assert.match(ui, /function DeleteMemberConfirmation\(\{name,pending,error,onCancel,onConfirm\}/);
  assert.match(ui, /<p className="staff-confirm-error" role="alert">\{error\}<\/p>/);
  assert.match(
    ui,
    /error=\{error\} onCancel=\{\(\)=>\{setDeleteConfirm\(null\);setError\(""\)\}\}/,
  );
});

test("Actual directory adapter reports the SQLSTATE without leaking provider payloads and validates successful response shape", async () => {
  const before = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SECRET_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.invalid";
  process.env.SUPABASE_SECRET_KEY = "fixture";
  let payload = { members: [], invitations: [], audit: [], truncated: false },
    error = { code: "42702", message: "PRIVATE_PAYLOAD" };
  const warnings = [],
    warn = console.warn;
  console.warn = (v) => warnings.push(v);
  const db = {
    rpc: (name, args) => {
      assert.equal(name, "staff_access_control");
      assert.deepEqual(args, { p_action: "directory", p_actor: id, p_data: {} });
      return { abortSignal: async () => ({ data: payload, error }) };
    },
  };
  const service = load("src/lib/staff-access/server.ts", {
    "server-only": {},
    "@supabase/supabase-js": { createClient: () => db },
    "../staff-auth": {},
  });
  try {
    await assert.rejects(() => service.staffRPC("directory", id), /Refresh and try again/);
    assert.equal(warnings[0].code, "42702");
    assert(!JSON.stringify(warnings).includes("PRIVATE_PAYLOAD"));
    error = null;
    assert.deepEqual(await service.staffRPC("directory", id), payload);
    payload = { wrong: "PRIVATE_RECORD" };
    await assert.rejects(() => service.staffRPC("directory", id));
    assert.equal(warnings.at(-1).category, "invalid_response");
    assert(!JSON.stringify(warnings).includes("PRIVATE_RECORD"));
  } finally {
    console.warn = warn;
    for (const [key, value] of Object.entries({
      NEXT_PUBLIC_SUPABASE_URL: before.url,
      SUPABASE_SECRET_KEY: before.key,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
