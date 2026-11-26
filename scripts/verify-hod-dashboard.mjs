import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const auth = read("src", "lib", "staff-auth.ts");
const gate = read("src", "app", "dashboard", "access.ts");
const nav = read("src", "app", "dashboard", "navigation.tsx");
const migration = read("supabase", "migrations", "20261125100000_hod_dashboard_access.sql");

test("HOD access requires a verified company account, active HOD membership, and real assignments", () => {
  assert.match(auth, /user\.email_confirmed_at/);
  assert.match(auth, /role", "hod"\)\.eq\("status", "active"\)/);
  assert.match(auth, /staff_department_assignments/);
  assert.match(auth, /departments\.length === 0/);
  assert.match(gate, /getHodDashboardAccess/);
  assert.match(gate, /getStaffRole/);
});

test("Employee and Client routes remain outside the HOD navigation", () => {
  assert.match(auth, /data\?\.role !== "ceo" && data\?\.role !== "admin"/);
  assert.match(nav, /key !== "clients"/);
  assert.match(nav, /key !== "insights"/);
  assert.match(nav, /href: "\/dashboard\/games"/);
});

test("HOD plan writes are optimistic, author-scoped, assigned-person validated, and one-way on submit", () => {
  assert.match(migration, /hod_department_plan_save/);
  assert.match(migration, /plan\.created_by<>person/);
  assert.match(migration, /plan\.version<>p_expected_version/);
  assert.match(migration, /staff_assigned_account\(task_owner,p_department\)/);
  assert.match(migration, /status='submitted',submitted_by=person,submitted_at/);
  assert.match(migration, /hod_department_plan_requests/);
});

test("HOD approval rows and attachments stay bound to the signed-in requester", () => {
  assert.match(migration, /requester_id=auth\.uid\(\)/);
  assert.match(migration, /HODs read only their own approval documents/);
  assert.match(read("src", "app", "dashboard", "approvals", "api", "route.ts"), /requireHodDashboardAccess/);
});

test("HOD calendar creates only for current departments; edits and Admin meeting controls remain gated", () => {
  assert.match(migration, /calendar_hod_create/);
  assert.match(migration, /not v_departments <@ array/);
  assert.match(read("src", "app", "dashboard", "calendar", "api", "route.ts"), /auth\.role === "HOD" && body\.command !== "create"/);
  assert.match(read("src", "app", "dashboard", "calendar", "api", "[id]", "end", "route.ts"), /auth\.role!=="Admin"/);
});

test("HOD recipients get published announcements and published recognition only", () => {
  assert.match(migration, /announcement_recipient_access/);
  assert.match(migration, /Active HODs read published recognition results/);
  assert.doesNotMatch(migration, /create policy\s+"[^"\n]*HOD[^"\n]*(nomination|review)/i);
});

test("HOD Games reuse move RPC validation with active assignment checks", () => {
  assert.match(migration, /games_lobby_command/);
  assert.match(migration, /games_commit/);
  assert.match(migration, /hod_dashboard_member\(p_actor\)/);
});

test("HOD Connect replacement preserves the deployed three-column RPC contract", () => {
  const baseMigration = read("supabase", "migrations", "20261121100000_private_department_rooms.sql");
  const signature = /create function public\.connect_department_members\(room uuid\)\s+returns table\(([^)]+)\)/i;
  const base = signature.exec(baseMigration)?.[1].replace(/\s+/g, "").toLowerCase();
  const replacement = /create or replace function public\.connect_department_members\(room uuid\)\s+--[\s\S]*?returns table\(([^)]+)\)/i.exec(migration)?.[1].replace(/\s+/g, "").toLowerCase();
  assert.equal(base, "user_iduuid,display_nametext,avatar_urltext");
  assert.equal(replacement, base, "PostgreSQL cannot replace an OUT-parameter row type with a different shape");
  assert.match(migration, /connect_can_read\(room\)/);
  assert.match(migration, /a\.department=c\.department/);
});

test("HOD reminder integration routes game invitations to their protected room", () => {
  const route = read("src", "app", "dashboard", "notifications", "hod", "route.ts");
  const ui = read("src", "app", "dashboard", "notifications", "hod-reminders.tsx");
  assert.match(route, /calendar_occurrence_id,game_room_id/);
  assert.match(ui, /item\.game_room_id\?`\/dashboard\/games\?room=\$\{item\.game_room_id\}`/);
  assert.match(ui, /item\.game_room_id\?"Game invitation"/);
});

test("Connect compatibility migration checks dependencies, recreates without CASCADE, and restores authenticated access", () => {
  const repair = read("supabase", "migrations", "20261125110000_hod_connect_members_contract_repair.sql");
  const diagnostic = read("supabase", "checks", "hod_connect_members_contract_verification.sql");
  assert.match(repair, /pg_depend/);
  assert.match(repair, /catalog dependents/);
  assert.match(repair, /drop function public\.connect_department_members\(uuid\)/i);
  assert.doesNotMatch(repair, /drop function[^;]*cascade/i);
  assert.match(repair, /revoke all .*from public,anon,authenticated/i);
  assert.match(repair, /grant execute .*to authenticated/i);
  assert.match(diagnostic, /begin transaction read only/i);
  assert.match(diagnostic, /rollback/i);
  assert.match(diagnostic, /to_regprocedure\('public\.connect_department_members\(uuid\)'\)/i);
  assert.match(diagnostic, /select case when bool_and\(passed\) then 'PASS' else 'FAIL' end/i);
});
