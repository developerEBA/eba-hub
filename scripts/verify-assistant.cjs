/* eslint-disable @typescript-eslint/no-require-imports -- Source-level verification harness. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("read-only helper is mounted in the shared executive and HOD dashboard shell", () => {
  const shell = read("src", "app", "dashboard", "dashboard-shell.tsx");
  const ui = read("src", "app", "dashboard", "assistant", "assistant.tsx");
  assert.match(shell, /<EbaAssistant role=\{role\}\s*\/>/);
  assert.match(ui, /aria-label="EBA Assistant"/);
  assert.match(ui, /data-announcement-block/);
  assert.match(ui, /node\.showModal\(\)/);
  assert.match(ui, /onCancel/);
  assert.match(ui, /requestAnimationFrame\(\(\) => launcher\.current\?\.focus\(\)\)/);
  assert.match(ui, /Quick workspace guidance · read-only/);
});

test("data endpoint checks active dashboard access and returns minimal uncached results", () => {
  const route = read("src", "app", "dashboard", "assistant", "api", "route.ts");
  assert.match(route, /createStaffClient\(\)/);
  assert.match(route, /client\.auth\.getUser\(\)/);
  assert.match(route, /getStaffRole\(client, data\.user\)/);
  assert.match(route, /getHodDashboardAccess\(client, data\.user\)/);
  assert.match(route, /Cache-Control": "private, no-store/);
  assert.match(route, /select\("id,title,request_type,department,submitted_at,status"/);
  assert.match(route, /loadMeetings\(client, data\.user\.id, "upcoming", 5, role\)/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SECRET_KEY|agenda|join_url/);
});
