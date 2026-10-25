import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, basename } from "node:path";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
let db: PGlite;
let testDbPath: string;
const admin = "10000000-0000-4000-8000-000000000001",
  a = "10000000-0000-4000-8000-000000000002",
  b = "10000000-0000-4000-8000-000000000003",
  outsider = "10000000-0000-4000-8000-000000000004",
  other = "10000000-0000-4000-8000-000000000006",
  department = "20000000-0000-4000-8000-000000000001";
let project: string, task: string, conversation: string;
async function asUser<T>(id: string, run: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try {
    return await run();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}
before(async () => {
  testDbPath = await mkdtemp(join(tmpdir(), "eba-hub-postgres-"));
  db = new PGlite(testDbPath);
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const file of [
    "202610250001_workspace_foundation.sql",
    "202610250002_roles.sql",
    "202610250003_workspace_modules.sql",
    "202610250004_authenticated_operations.sql",
    "202610250005_files_meetings_reminders.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  for (const id of [admin, a, b, outsider, other])
    await db.query("insert into auth.users values($1)", [id]);
  for (const [id, role] of [
    [admin, "admin"],
    [a, "employee"],
    [b, "employee"],
    [other, "employee"],
  ])
    await db.query(
      "insert into employee_profiles(id,display_name,role) values($1,$2,$3::workspace_role)",
      [id, `Test ${role} ${id.slice(-1)}`, role],
    );
  await db.query(
    "insert into departments(id,name) values($1,'Test department')",
    [department],
  );
  for (const id of [admin, a, b, other])
    await db.query("insert into department_memberships values($1,$2)", [
      department,
      id,
    ]);
  const created = await asUser(admin, () =>
    db.query<{ id: string }>(
      "select create_workspace_project('Private test project',$1,null,$2::uuid[]) id",
      [department, [a]],
    ),
  );
  project = created.rows[0].id;
  const made = await asUser(a, () =>
    db.query<{ id: string }>(
      "insert into tasks(project_id,title,assignee_id,created_by) values($1,'Persisted task',$2,$2) returning id",
      [project, a],
    ),
  );
  task = made.rows[0].id;
});
after(async () => {
  await db.close();
  const target = resolve(testDbPath),
    inside = relative(resolve(tmpdir()), target);
  if (
    inside &&
    !inside.startsWith("..") &&
    basename(target).startsWith("eba-hub-postgres-")
  )
    await rm(target, { recursive: true, force: true });
});
test("PostgreSQL migrations 001–005 execute successfully", async () => {
  const result = await db.query(
    "select tablename from pg_tables where schemaname='public'",
  );
  assert.ok(result.rows.length >= 20);
});
test("task changes survive a fresh authenticated query and update database counts", async () => {
  await asUser(a, () =>
    db.query(
      "update tasks set title='Revised task',priority='high',status='complete' where id=$1",
      [task],
    ),
  );
  const reread = await asUser(a, () =>
    db.query<{ title: string; status: string; priority: string }>(
      "select title,status,priority from tasks where id=$1",
      [task],
    ),
  );
  assert.deepEqual(reread.rows[0], {
    title: "Revised task",
    status: "complete",
    priority: "high",
  });
  const counts = await asUser(a, () =>
    db.query<{ counts: { tasks: number } }>("select workspace_counts() counts"),
  );
  assert.equal(counts.rows[0].counts.tasks, 0);
  const progress = await asUser(a, () =>
    db.query<{ progress: number }>(
      "select progress from project_delivery where project_id=$1",
      [project],
    ),
  );
  assert.equal(progress.rows[0].progress, 100);
});
test("nonmembers and nonemployees cannot read or mutate protected project records", async () => {
  for (const id of [b, other, outsider]) {
    const read = await asUser(id, () =>
      db.query("select * from tasks where id=$1", [task]),
    );
    assert.equal(read.rows.length, 0);
    const write = await asUser(id, () =>
      db.query("update tasks set title='Attack' where id=$1 returning id", [
        task,
      ]),
    );
    assert.equal(write.rows.length, 0);
  }
  await assert.rejects(
    asUser(b, () =>
      db.query(
        "insert into tasks(project_id,title,created_by) values($1,'Attack',$2)",
        [project, b],
      ),
    ),
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("update employee_profiles set role='admin' where id=$1", [a]),
    ),
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("update tasks set created_by=$1 where id=$2", [b, task]),
    ),
  );
});
test("project create/update and participant checks are enforced in PostgreSQL", async () => {
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "select create_workspace_project('No authority',$1,null,$2::uuid[])",
        [department, [a]],
      ),
    ),
  );
  await asUser(admin, () =>
    db.query(
      "update projects set name='Renamed project',status='active' where id=$1",
      [project],
    ),
  );
  const read = await asUser(a, () =>
    db.query<{ name: string }>("select name from projects where id=$1", [
      project,
    ]),
  );
  assert.equal(read.rows[0].name, "Renamed project");
  await assert.rejects(
    asUser(admin, () =>
      db.query("select set_project_members($1,$2::uuid[])", [project, [b]]),
    ),
  );
});
test("private messages persist across two identities; outsiders and impersonation are denied", async () => {
  const created = await asUser(a, () =>
    db.query<{ id: string }>(
      "select create_workspace_conversation('Private chat','private',$1::uuid[]) id",
      [[b]],
    ),
  );
  conversation = created.rows[0].id;
  await asUser(a, () =>
    db.query(
      "insert into messages(conversation_id,sender_id,body) values($1,$2,'A real stored message')",
      [conversation, a],
    ),
  );
  const received = await asUser(b, () =>
    db.query<{ body: string }>(
      "select body from messages where conversation_id=$1",
      [conversation],
    ),
  );
  assert.equal(received.rows[0].body, "A real stored message");
  assert.equal(
    (
      await asUser(other, () =>
        db.query("select id from messages where conversation_id=$1", [
          conversation,
        ]),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "insert into messages(conversation_id,sender_id,body) values($1,$2,'Impersonation')",
        [conversation, b],
      ),
    ),
  );
  await assert.rejects(
    asUser(other, () =>
      db.query(
        "insert into messages(conversation_id,sender_id,body) values($1,$2,'Intrusion')",
        [conversation, other],
      ),
    ),
  );
});
test("approval review is atomic, role checked, non-self and single decision", async () => {
  const request = await asUser(a, () =>
    db.query<{ id: string }>(
      "insert into approvals(requester_id,title,body) values($1,'Purchase request','Review this request') returning id",
      [a],
    ),
  );
  const id = request.rows[0].id;
  await assert.rejects(
    asUser(a, () => db.query("select review_approval($1,'approved')", [id])),
  );
  await asUser(admin, () =>
    db.query("select review_approval($1,'approved')", [id]),
  );
  await assert.rejects(
    asUser(admin, () =>
      db.query("select review_approval($1,'rejected')", [id]),
    ),
  );
  const stored = await asUser(a, () =>
    db.query<{ status: string }>("select status from approvals where id=$1", [
      id,
    ]),
  );
  assert.equal(stored.rows[0].status, "approved");
  const notification = await asUser(a, () =>
    db.query(
      "select id from notifications where title='Purchase request: approved'",
    ),
  );
  assert.equal(notification.rows.length, 1);
});
test("leave submission rejects invalid ranges without a partial approval record", async () => {
  const before = await db.query<{ count: number }>(
    "select count(*)::integer count from approvals",
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("select submit_leave('2026-12-10','2026-12-01','Invalid')"),
    ),
  );
  const after = await db.query<{ count: number }>(
    "select count(*)::integer count from approvals",
  );
  assert.equal(after.rows[0].count, before.rows[0].count);
  await asUser(a, () =>
    db.query("select submit_leave('2026-12-01','2026-12-03','Annual leave')"),
  );
  assert.equal(
    (await asUser(a, () => db.query("select id from leave_requests"))).rows
      .length,
    1,
  );
  assert.equal(
    (await asUser(b, () => db.query("select id from leave_requests"))).rows
      .length,
    0,
  );
});
test("focus and profile changes persist while another employee cannot edit them", async () => {
  const made = await asUser(a, () =>
    db.query<{ id: string }>(
      "insert into focus_items(employee_id,title) values($1,'Real focus') returning id",
      [a],
    ),
  );
  await asUser(a, () =>
    db.query("update focus_items set complete=true where id=$1", [
      made.rows[0].id,
    ]),
  );
  assert.equal(
    (await asUser(b, () => db.query("select id from focus_items"))).rows.length,
    0,
  );
  await asUser(a, () =>
    db.query(
      "update employee_profiles set display_name='Updated employee' where id=$1",
      [a],
    ),
  );
  assert.equal(
    (
      await asUser(a, () =>
        db.query<{ display_name: string }>(
          "select display_name from employee_profiles where id=$1",
          [a],
        ),
      )
    ).rows[0].display_name,
    "Updated employee",
  );
});
test("durable task reminder delivery is idempotent and not callable by employees", async () => {
  await asUser(a, () =>
    db.query(
      "update tasks set status='todo',due_at=now()+interval '5 minutes' where id=$1",
      [task],
    ),
  );
  await assert.rejects(
    asUser(a, () => db.query("select deliver_due_reminders()")),
  );
  assert.equal(
    (await db.query<{ sent: number }>("select deliver_due_reminders() sent"))
      .rows[0].sent,
    1,
  );
  assert.equal(
    (await db.query<{ sent: number }>("select deliver_due_reminders() sent"))
      .rows[0].sent,
    0,
  );
  assert.equal(
    (
      await asUser(a, () =>
        db.query(
          "select id from notifications where reminder_job_id is not null",
        ),
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (await asUser(b, () => db.query("select id from notifications"))).rows
      .length,
    0,
  );
});
test("meeting invitations persist for attendees without fabricating a Meet URL", async () => {
  const scheduled = await asUser(a, () =>
    db.query<{ id: string }>(
      "select schedule_workspace_meeting('Planning','2026-12-01T10:00Z','2026-12-01T11:00Z',$1::uuid[]) id",
      [[b]],
    ),
  );
  const id = scheduled.rows[0].id;
  const received = await asUser(b, () =>
    db.query<{ meet_url: string | null }>(
      "select meet_url from meetings where id=$1",
      [id],
    ),
  );
  assert.equal(received.rows[0].meet_url, null);
  assert.equal(
    (
      await asUser(other, () =>
        db.query("select id from meetings where id=$1", [id]),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    asUser(b, () =>
      db.query("select update_meeting_attendees($1,$2::uuid[])", [id, [other]]),
    ),
  );
});
test("deactivated employees lose direct database access as well as application access", async () => {
  await db.query("update employee_profiles set is_active=false where id=$1", [
    a,
  ]);
  try {
    assert.equal(
      (await asUser(a, () => db.query("select id from messages"))).rows.length,
      0,
    );
    assert.equal(
      (await asUser(a, () => db.query("select id from notifications"))).rows
        .length,
      0,
    );
    assert.equal(
      (await asUser(a, () => db.query("select id from tasks"))).rows.length,
      0,
    );
    await assert.rejects(
      asUser(a, () =>
        db.query(
          "select submit_leave('2026-12-01','2026-12-02','Inactive request')",
        ),
      ),
    );
  } finally {
    await db.query("update employee_profiles set is_active=true where id=$1", [
      a,
    ]);
  }
});
test("recognition is published only after independent management approval", async () => {
  const period = await asUser(admin, () =>
    db.query<{ id: string }>(
      "insert into award_periods(title,starts_on,ends_on) values('Open period',current_date-1,current_date+1) returning id",
    ),
  );
  await assert.rejects(
    asUser(a, () =>
      db.query("select submit_nomination($1,$2,'Self nomination')", [
        period.rows[0].id,
        a,
      ]),
    ),
  );
  const made = await asUser(a, () =>
    db.query<{ id: string }>(
      "select submit_nomination($1,$2,'Documented contribution') id",
      [period.rows[0].id, b],
    ),
  );
  assert.equal(
    (await asUser(b, () => db.query("select id from recognition"))).rows.length,
    0,
  );
  await asUser(admin, () =>
    db.query("select review_approval($1,'approved')", [made.rows[0].id]),
  );
  assert.equal(
    (
      await asUser(b, () =>
        db.query("select id from recognition where recipient_id=$1", [b]),
      )
    ).rows.length,
    1,
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "insert into recognition(sender_id,recipient_id,message) values($1,$2,'Bypass review')",
        [a, b],
      ),
    ),
  );
});
test("attachment metadata is scoped and an unrelated private file cannot be attached", async () => {
  const shared = await asUser(a, () =>
    db.query<{ id: string }>(
      "insert into workspace_files(owner_id,conversation_id,path,name,mime_type,size_bytes) values($1,$2,$3,'Shared.txt','text/plain',10) returning id",
      [a, conversation, `${a}/30000000-0000-4000-8000-000000000001`],
    ),
  );
  assert.equal(
    (
      await asUser(b, () =>
        db.query("select id from workspace_files where id=$1", [
          shared.rows[0].id,
        ]),
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await asUser(other, () =>
        db.query("select id from workspace_files where id=$1", [
          shared.rows[0].id,
        ]),
      )
    ).rows.length,
    0,
  );
  const personal = await asUser(a, () =>
    db.query<{ id: string }>(
      "insert into workspace_files(owner_id,path,name,mime_type,size_bytes) values($1,$2,'Private.txt','text/plain',10) returning id",
      [a, `${a}/30000000-0000-4000-8000-000000000002`],
    ),
  );
  await assert.rejects(
    asUser(a, () =>
      db.query(
        "insert into messages(conversation_id,sender_id,body,kind,attachment_id) values($1,$2,'Unshared file','file',$3)",
        [conversation, a, personal.rows[0].id],
      ),
    ),
  );
  await asUser(a, () =>
    db.query(
      "insert into messages(conversation_id,sender_id,body,kind,attachment_id) values($1,$2,'Shared file','file',$3)",
      [conversation, a, shared.rows[0].id],
    ),
  );
});
test("management cannot approve its own request or its own nomination", async () => {
  const request = await asUser(admin, () =>
    db.query<{ id: string }>(
      "insert into approvals(requester_id,title,body) values($1,'Self review','Should fail') returning id",
      [admin],
    ),
  );
  await assert.rejects(
    asUser(admin, () =>
      db.query("select review_approval($1,'approved')", [request.rows[0].id]),
    ),
  );
  const period = await db.query<{ id: string }>(
    "select id from award_periods limit 1",
  );
  const nomination = await asUser(a, () =>
    db.query<{ id: string }>(
      "select submit_nomination($1,$2,'Admin contribution') id",
      [period.rows[0].id, admin],
    ),
  );
  await assert.rejects(
    asUser(admin, () =>
      db.query("select review_approval($1,'approved')", [
        nomination.rows[0].id,
      ]),
    ),
  );
});
test("reminder failures retry with tracking and stop after five attempts", async () => {
  const made = await asUser(a, () =>
    db.query<{ id: string }>(
      "insert into tasks(project_id,title,assignee_id,created_by,due_at) values($1,'Retry fixture',$2,$2,now()+interval '5 minutes') returning id",
      [project, a],
    ),
  );
  const id = made.rows[0].id;
  await db.exec(
    "create function test_notification_failure() returns trigger language plpgsql as $$ begin if new.title='Task due soon: Retry fixture' then raise exception 'Test delivery failure';end if;return new;end $$;create trigger notification_failure before insert on notifications for each row execute function test_notification_failure();",
  );
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await db.query(
        "update reminder_jobs set run_at=now()-interval '1 minute' where task_id=$1",
        [id],
      );
      await db.query("select deliver_due_reminders()");
      const state = await db.query<{
        attempts: number;
        state: string;
        last_error: string;
      }>(
        "select attempts,state,last_error from reminder_jobs where task_id=$1",
        [id],
      );
      assert.equal(state.rows[0].attempts, attempt);
      assert.equal(state.rows[0].state, attempt === 5 ? "failed" : "pending");
      assert.equal(state.rows[0].last_error, "P0001");
    }
  } finally {
    await db.exec(
      "drop trigger notification_failure on notifications;drop function test_notification_failure();",
    );
  }
});

test("stored records survive closing and reopening disk-backed PostgreSQL", async () => {
  await db.close();
  db = new PGlite(testDbPath);
  const stored = await asUser(a, () =>
    db.query<{ id: string; title: string }>(
      "select id,title from tasks where id=$1",
      [task],
    ),
  );
  assert.equal(stored.rows[0].id, task);
  assert.equal(stored.rows[0].title, "Revised task");
  const message = await asUser(b, () =>
    db.query<{ body: string }>(
      "select body from messages where conversation_id=$1 and body='A real stored message'",
      [conversation],
    ),
  );
  assert.equal(message.rows.length, 1);
});
test("saving unchanged reminder fields does not rearm a delivered job", async () => {
  const before = await db.query<{ state: string; attempts: number }>(
    "select state,attempts from reminder_jobs where task_id=$1",
    [task],
  );
  assert.equal(before.rows[0].state, "delivered");
  await asUser(a, () =>
    db.query("update tasks set status=status,priority='low' where id=$1", [
      task,
    ]),
  );
  const after = await db.query<{ state: string; attempts: number }>(
    "select state,attempts from reminder_jobs where task_id=$1",
    [task],
  );
  assert.deepEqual(after.rows[0], before.rows[0]);
});
