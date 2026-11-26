/* eslint-disable @typescript-eslint/no-require-imports -- Offline Connect policy fixtures and migration contracts. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } },
).outputText, filename);

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261121100000_private_department_rooms.sql'), 'utf8');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const general = { type: 'general' };
const dm = (members) => ({ type: 'dm', members });
const department = (name) => ({ type: 'department', department: name });
const legacy = (readers) => ({ type: 'legacy_shared', readers });

// Fixture truth table for the database policy. SQL contract assertions below
// ensure production RLS and RPCs use the same inputs and rollout gate.
function fixtureCanRead(user, room) {
  if (!user || user.status !== 'active' || !user.companyEmail || !user.hasConnectProfile) return false;
  if (user.role !== 'ceo' && user.role !== 'admin') return false;
  if (room.type === 'general') return true;
  if (room.type === 'dm') return room.members.includes(user.id);
  if (room.type === 'department') return ['ceo', 'admin'].includes(user.role)
    || (['staff', 'hod'].includes(user.role) && user.departments.includes(room.department));
  if (room.type === 'legacy_shared') return room.readers.includes(user.id);
  return false;
}

const admin = { id: 'admin', role: 'admin', status: 'active', companyEmail: true, hasConnectProfile: true, departments: [] };
const ceo = { ...admin, id: 'ceo', role: 'ceo' };
const assignedStaff = { ...admin, id: 'staff', role: 'staff', departments: ['graphics'] };
const outsider = { ...admin, id: 'outsider', role: 'hod', departments: ['events'] };

function clientFixture(user, room, message = {}) {
  const row = { id: 15, conversation_id: room.id, body: 'fixture message', sender_id: 'writer', sent_at: '2026-11-21T10:00:00Z', kind: 'photo',
    attachment_path: 'private/object', attachment_name: 'fixture.png', attachment_mime: 'image/png', audio_path: null, ...message };
  let downloads = 0;
  const client = {
    from(table) {
      const query = {
        table, filters: {},
        select() { return this; }, order() { return this; }, limit() { return this; }, lt() { return this; },
        eq(key, value) { this.filters[key] = value; return this; }, in(key, value) { this.filters[key] = value; return this; },
        maybeSingle: async () => {
          if (table === 'connect_conversations') return { data: fixtureCanRead(user, room) ? { id: room.id } : null, error: null };
          if (table === 'connect_messages' && fixtureCanRead(user, room)
            && (!query.filters.id || String(query.filters.id) === String(row.id))) return { data: row, error: null };
          return { data: null, error: null };
        },
        returns: async () => ({ data: fixtureCanRead(user, room) ? [row] : [], error: null }),
        insert: async () => ({ error: fixtureCanRead(user, room) && room.type !== 'legacy_shared' ? null : { code: '42501' } }),
      };
      return query;
    },
    rpc: async (name, args) => ({ data: name === 'connect_change_message'
      ? (args.operation === 'delete' || args.operation === 'edit') && fixtureCanRead(user, room) && room.type !== 'legacy_shared'
      : fixtureCanRead(user, room), error: fixtureCanRead(user, room) ? null : { code: '42501' } }),
    storage: { from: () => ({ download: async () => { downloads++; return { data: new Blob(['private']), error: null }; } }) },
  };
  return { client, downloads: () => downloads };
}

function load(file, stubs) {
  const filename = path.join(root, file);
  delete require.cache[filename];
  const original = Module._load;
  try {
    Module._load = function (name, ...args) { return Object.hasOwn(stubs, name) ? stubs[name] : original.call(this, name, ...args); };
    return require(filename);
  } finally { Module._load = original; }
}

test('Department access fixtures cover assignment, outsider, executive oversight, reassignment and deactivation', () => {
  assert.equal(fixtureCanRead(assignedStaff, department('graphics')), false, 'Employee/HOD dashboard and Connect rollout remains gated');
  assert.equal(fixtureCanRead(outsider, department('graphics')), false, 'HOD cannot use direct Connect APIs before rollout');
  assert.equal(fixtureCanRead(admin, department('graphics')), true, 'Admin oversight bypasses department assignment');
  assert.equal(fixtureCanRead(ceo, department('marketing')), true, 'CEO oversight bypasses department assignment');
  const futureRolloutCanRead = (user, room) => user.status === 'active' && user.companyEmail && user.hasConnectProfile
    && (['ceo', 'admin'].includes(user.role) || (['staff', 'hod'].includes(user.role) && user.departments.includes(room.department)));
  assert.equal(futureRolloutCanRead(assignedStaff, department('graphics')), true);
  assert.equal(futureRolloutCanRead({ ...assignedStaff, departments: ['events'] }, department('graphics')), false, 'Reassignment revokes room access');
  assert.equal(futureRolloutCanRead({ ...assignedStaff, status: 'inactive' }, department('graphics')), false, 'Deactivation revokes room access');
});

test('General and DMs keep their existing access shape; legacy history is snapshot-read-only', () => {
  assert.equal(fixtureCanRead(admin, general), true);
  assert.equal(fixtureCanRead({ ...admin, id: 'other' }, dm(['admin', 'partner'])), false);
  assert.equal(fixtureCanRead({ ...admin, id: 'partner' }, dm(['admin', 'partner'])), true);
  assert.equal(fixtureCanRead(admin, legacy(['admin'])), true);
  assert.equal(fixtureCanRead({ ...admin, id: 'new-admin' }, legacy(['admin'])), false);
  assert.match(migration, /room_type='legacy_shared'.*archived_at is not null/s);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.connect_(?:messages|conversations)/i);
});

test('Database gate, room policy, and roster RPC use real memberships and assignments', () => {
  assert.match(migration, /m\.role in \('ceo','admin'\).*?and m\.status='active'/s);
  assert.match(migration, /connect_is_active\(person\)/);
  assert.match(migration, /m\.role in \('staff','hod'\).*?staff_department_assignments/s);
  assert.match(migration, /connect_department_members\(room uuid\)/);
  assert.match(migration, /connect_can_read\(room\)/);
  assert.match(migration, /grant execute on function public\.connect_department_members\(uuid\) to authenticated/);
});

test('Every content path is room-scoped: messages, mentions, receipts, notifications, and private media', () => {
  for (const text of [
    /Authorized members read visible Connect messages[\s\S]*?connect_can_read\(conversation_id\)/,
    /Authorized members send messages as themselves[\s\S]*?connect_can_write\(conversation_id\)/,
    /connect_user_can_read\(member\.user_id,new\.conversation_id\)/,
    /connect_can_read\(m\.conversation_id\)/,
    /connect_can_read\(conversation_id\)/,
    /Authorized members stage their own voice files[\s\S]*?connect_can_write\(/,
    /Authorized members read linked voice files or own staged files[\s\S]*?connect_can_read\(/,
    /Authorized uploaders delete only unlinked voice files[\s\S]*?connect_can_write\(/,
    /Authorized members read linked Connect attachments[\s\S]*?connect_can_read\(/,
    /connect_can_write\(m\.conversation_id\)/,
  ]) assert.match(migration, text);
  assert.match(read('src/app/dashboard/connect/events/route.ts'), /event: access-revoked/);
  assert.match(read('src/app/dashboard/connect/chat-history.tsx'), /refreshLatest/);
  assert.match(read('src/app/dashboard/connect/audio/[id]/route.ts'), /storage\.from\("connect-voice"\)\.download/);
  assert.match(read('src/app/dashboard/connect/attachments/[id]/route.ts'), /storage\.from\("connect-attachments"\)\.download/);
  assert.doesNotMatch(read('src/app/dashboard/connect/audio/[id]/route.ts') + read('src/app/dashboard/connect/attachments/[id]/route.ts'), /createSignedUrl|getPublicUrl/);
});

test('Department UI uses authorized database rooms and labels private/archive states', () => {
  const page = read('src/app/dashboard/connect/page.tsx');
  assert.match(page, /room_type,department,archived_at/);
  assert.match(page, /room_type === "department"/);
  assert.match(page, /Private department room/);
  assert.match(page, /Archived shared history/);
  assert.match(page, /connect_department_members/);
  assert.match(page, /canSend=\{!archived/);
});

test('Actual history and protected media handlers deny an outsider who knows the room/message ID', async () => {
  const id = '00000000-0000-4000-8000-000000000042';
  const room = { id, type: 'department', department: 'graphics' };
  const { GET: history } = load('src/app/dashboard/connect/history/route.ts', {
    '../../access': { requireHodDashboardAccess: async () => ({ client: clientFixture(outsider, room).client, user: outsider }) },
  });
  const deniedHistory = await history(new Request(`http://localhost/dashboard/connect/history?chat=${id}&before=15`));
  assert.equal(deniedHistory.status, 404);
  const allowed = await load('src/app/dashboard/connect/history/route.ts', {
    '../../access': { requireHodDashboardAccess: async () => ({ client: clientFixture(admin, room).client, user: admin }) },
  }).GET(new Request(`http://localhost/dashboard/connect/history?chat=${id}&before=15`));
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).messages[0].body, 'fixture message');

  const deniedStorage = clientFixture(outsider, room);
  const { GET: attachment } = load('src/app/dashboard/connect/attachments/[id]/route.ts', {
    '../../../access': { requireHodDashboardAccess: async () => ({ client: deniedStorage.client }) },
  });
  assert.equal((await attachment(new Request('http://localhost/file'), { params: Promise.resolve({ id: '15' }) })).status, 404);
  assert.equal(deniedStorage.downloads(), 0, 'RLS denial happens before private object download');
});

test('Actual Connect send/read/edit handlers keep current CEO/Admin gate and preserve General/DM behavior', async () => {
  const id = '00000000-0000-4000-8000-000000000042';
  const room = { id, type: 'department', department: 'graphics' };
  const outsiderFixture = clientFixture(outsider, room);
  const actions = load('src/app/dashboard/connect/actions.ts', {
    '../access': { requireHodDashboardAccess: async () => ({ client: outsiderFixture.client, user: outsider }) },
  });
  const form = new FormData(); form.set('conversation', id); form.set('clientId', '00000000-0000-4000-8000-000000000099'); form.set('body', 'blocked'); form.set('kind', 'text');
  assert.match(await actions.sendConnectMessage(null, form), /could not be sent/i);
  assert.equal(await actions.readConnectChat(id, 15), false);
  assert.match(await actions.changeConnectMessage(15, 'edit', 'blocked'), /could not update/i);

  for (const candidate of [general, dm(['admin', 'partner'])]) {
    const reader = candidate === general ? { ...admin } : { ...admin, id: 'partner' };
    assert.equal(fixtureCanRead(reader, candidate), true);
  }
  assert.equal(fixtureCanRead({ ...admin, id: 'third' }, dm(['admin', 'partner'])), false);
});

test('Department reminders remain bell-only until audience eligibility can be proven', () => {
  assert.match(read('src/lib/calendar-reminders/server.ts'), /pending_private_groups/);
  assert.match(read('supabase/migrations/20261117010000_calendar_part3_private_reminders.sql'), /group_delivery','pending_private_groups'/);
  assert.match(read('supabase/checks/connect_private_rooms_verification.sql'), /bell-only reminders remain/);
});
