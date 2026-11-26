/* eslint-disable @typescript-eslint/no-require-imports*/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function source(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const js = ts.transpileModule(source(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${js}\n})`, { console, Date, Intl, URL, FormData, Response, Request })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('.')) return require(path.resolve(path.dirname(filename), name));
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}

test('Lagos period boundaries and calendar validation use monthly starts only', () => {
  const periods = load('src/app/dashboard/insights/periods.ts');
  assert.equal(periods.recognitionPeriodStart('month', new Date('2026-11-30T23:30:00Z')), '2026-12-01');
  assert.equal(periods.isRecognitionPeriod('month', '2026-02-01'), true);
  assert.equal(periods.isRecognitionPeriod('month', '2026-02-02'), false);
  assert.equal(periods.nextRecognitionPeriod('month', '2026-01-01', 1), '2026-02-01');
  assert.equal(periods.recognitionPeriodClosed('month', '2026-10-01', new Date('2026-11-01T00:30:00Z')), true);
  assert.equal(periods.recognitionPeriodClosed('month', '2026-11-01', new Date('2026-11-01T00:30:00Z')), false);
  assert.equal(periods.latestCompletedRecognitionPeriod(new Date('2026-11-22T23:30:00Z')), '2026-10-01');
});

test('period status labels distinguish open, empty, pending reviews, agreement and publication', () => {
  const { getAwardDecision, getPeriodRecognitionStatus } = load('src/app/dashboard/insights/award-decision.ts');
  const status=(periodClosed,nominationsCount,reviews,result=null)=>getPeriodRecognitionStatus({periodClosed,nominationsCount,reviews,result,decision:getAwardDecision(
    reviews.find((review)=>review.reviewer_role==='ceo')?{nomineeId:reviews.find((review)=>review.reviewer_role==='ceo').nomination_id}:undefined,
    reviews.find((review)=>review.reviewer_role==='admin')?{nomineeId:reviews.find((review)=>review.reviewer_role==='admin').nomination_id}:undefined,
  )});
  assert.equal(status(false,0,[]),'Period in progress');
  assert.equal(status(true,0,[]),'No nominations yet');
  assert.equal(status(true,2,[]),'Awaiting CEO and Admin reviews');
  assert.equal(status(true,2,[{reviewer_role:'ceo',nomination_id:'a'}]),'Awaiting Admin review');
  assert.equal(status(true,2,[{reviewer_role:'admin',nomination_id:'a'}]),'Awaiting CEO review');
  assert.equal(status(true,2,[{reviewer_role:'ceo',nomination_id:'a'},{reviewer_role:'admin',nomination_id:'b'}]),'Reviewers disagree');
  assert.equal(status(true,2,[{reviewer_role:'ceo',nomination_id:'a'},{reviewer_role:'admin',nomination_id:'a'}]),'Agreed · awaiting publication');
  assert.equal(status(true,0,[{reviewer_role:'ceo',nomination_id:null},{reviewer_role:'admin',nomination_id:null}]),'No award agreed · awaiting publication');
  assert.equal(status(true,1,[],{outcome:'winner'}),'Winner announced');
  assert.equal(status(true,0,[],{outcome:'no_award'}),'No award');
  assert.doesNotMatch(source('src/app/dashboard/insights/period-award.tsx'),/"In review"/);
});

test('Insights uses the latest completed month and branded, non-particle surfaces with explicit sidebar states', () => {
  const page=source('src/app/dashboard/insights/page.tsx'), dashboardCss=source('src/app/dashboard/dashboard.css'), insightsCss=source('src/app/dashboard/insights/insights.css');
  assert.match(page,/latestCompletedRecognitionPeriod\(\)/);
  assert.match(page,/Most recent completed/); assert.match(page,/Current month/);
  assert.match(page,/Period in progress/);
  for (const state of [':link',':visited',':hover',':focus-visible',':active','[aria-current="page"]']) assert.ok(dashboardCss.includes(`.eba-dashboard__sidebar nav a${state}`),`sidebar has explicit ${state} styling`);
  assert.match(insightsCss,/\.eba-dashboard-galaxy\s*\{\s*display:\s*none/);
  assert.match(insightsCss,/background:\s*#f7f8f2/);
});

test('agreement fixtures cover independent decisions, disagreement and explicit no-award', () => {
  const { getAwardDecision } = load('src/app/dashboard/insights/award-decision.ts');
  assert.equal(getAwardDecision(undefined, undefined).status, 'awaiting_reviews');
  assert.equal(getAwardDecision({ nomineeId: 'one' }, { nomineeId: 'two' }).status, 'needs_agreement');
  assert.equal(getAwardDecision({ nomineeId: null }, { nomineeId: null }).status, 'no_award');
  assert.deepEqual(JSON.parse(JSON.stringify(getAwardDecision({ nomineeId: 'same' }, { nomineeId: 'same' }))), { status: 'ready_to_publish', nomineeId: 'same' });
});

test('actual period actions allow CEO/Admin nominations and keep publication CEO-only', async () => {
  let role = 'Admin'; const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: true, error: null }; } };
  const loaded = load('src/app/dashboard/insights/period-actions.ts', {
    '../access': { requireDashboardAccess: async () => ({ client, role }) },
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect(url) { throw Object.assign(new Error(url), { location: url }); } },
    './periods': load('src/app/dashboard/insights/periods.ts'), './recognition': { recognitionPath: '/dashboard/insights' },
  });
  const nomination = new FormData();
  for (const [k,v] of Object.entries({award_type:'employee_month',period_start:'2026-10-01',evidence_date:'2026-10-15',what_they_did:'Delivered a documented change',collaboration:'Worked with peers',who_benefited:'Client team',what_changed:'Reduced handoffs',evidence_url:'https://evidence.example/item'})) nomination.set(k,v);
  nomination.append('contributor_ids','10000000-0000-4000-8000-000000000001');
  await assert.rejects(() => loaded.submitPeriodNomination(null,nomination), error => error.location === '/dashboard/insights?cadence=month&period=2026-10-01');
  assert.equal(calls[0].name,'period_recognition_nominate'); assert.equal(calls[0].args.p_evidence_date,'2026-10-15');
  role='CEO'; await assert.rejects(() => loaded.submitPeriodNomination(null,nomination), error => error.location === '/dashboard/insights?cadence=month&period=2026-10-01');
  assert.equal(calls[1].name,'period_recognition_nominate','CEO nomination reaches the same protected RPC');
  const invalidEvidenceDate = new FormData(); for (const [k,v] of nomination.entries()) invalidEvidenceDate.append(k,k==='evidence_date'?'2026-11-01':v);
  assert.match(await loaded.submitPeriodNomination(null,invalidEvidenceDate),/evidence date|active staff/i);
  assert.equal(calls.length,2,'out-of-period evidence never reaches RPC');
  const publishForm = new FormData(); for (const [k,v] of Object.entries({ award_type:'employee_month',period_start:'2026-10-01',nomination_id:'no-award',reason:'Evidence did not support an award.',confirmed:'yes' })) publishForm.set(k,v);
  role='Admin';
  assert.equal(await loaded.publishPeriodRecognition(null,publishForm), 'Only an active CEO can publish a recognition result.');
  assert.equal(calls.length,2,'Admin cannot reach publication RPC');
  role = 'CEO'; await assert.rejects(() => loaded.publishPeriodRecognition(null,publishForm), error => error.location === '/dashboard/insights?cadence=month&period=2026-10-01&result=published');
  assert.equal(calls[2].name,'period_recognition_publish'); assert.equal(calls[2].args.p_nomination_id,null,'no-award outcome is preserved');
});

test('actual weekly actions allow executive evidence nominations and CEO-only winner/no-award publication', async () => {
  let role = 'Admin'; const calls = [];
  const client = { rpc: async (name,args) => { calls.push({name,args}); return {data:true,error:null}; } };
  const loaded = load('src/app/dashboard/insights/actions.ts', {
    '../access': { requireDashboardAccess: async () => ({client,role}) },
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect(url) { throw Object.assign(new Error(url),{location:url}); } },
    './recognition': { currentRecognitionWeek: ()=>'2026-11-16', isMonday: value=>value==='2026-11-16', loadRecognition:async()=>({data:null,error:null}), recognitionPath:'/dashboard/insights' },
  });
  const nomination = new FormData();
  for (const [key,value] of Object.entries({week:'2026-11-16',nominee:'10000000-0000-4000-8000-000000000001',evidence_date:'2026-11-17',what_they_did:'Delivered a reviewed change',who_benefited:'The team',what_changed:'Reduced rework',evidence_url:'https://evidence.example/week'})) nomination.set(key,value);
  await assert.rejects(()=>loaded.submitWeeklyNomination(null,nomination),error=>error.location==='/dashboard/insights?week=2026-11-16');
  assert.equal(calls[0].name,'submit_weekly_recognition_nomination');
  const badDate = new FormData(); for (const [key,value] of nomination.entries()) badDate.set(key,key==='evidence_date'?'2026-11-23':value);
  assert.match(await loaded.submitWeeklyNomination(null,badDate),/date inside this week/i); assert.equal(calls.length,1);
  const publish = new FormData(); for (const [key,value] of Object.entries({week:'2026-11-16',winner:'no-award',reason:'The evidence did not support an award.',confirmed:'yes'})) publish.set(key,value);
  assert.equal(await loaded.publishRecognition(null,publish),'Only an active CEO can publish a recognition result.'); assert.equal(calls.length,1);
  role='CEO'; await assert.rejects(()=>loaded.publishRecognition(null,publish),error=>error.location==='/dashboard/insights?week=2026-11-16');
  assert.equal(calls[1].name,'publish_weekly_recognition'); assert.equal(calls[1].args.p_winner_id,null);
});

test('forward SQL protects executive nominations and CEO-only publication for weekly and period awards', () => {
  const sql = source('supabase/migrations/20261121130000_period_recognition.sql');
  for (const pattern of [
    /create table public\.period_recognition_nominations/,
    /create table public\.period_recognition_reviews/,
    /create table public\.period_recognition_results/,
    /hub_is_active\(\)/,
    /reviewer_id = \(select auth\.uid\(\)\) or eba_private\.period_recognition_both_reviews/,
    /pg_advisory_xact_lock\(hashtextextended\(p_award_type\|\|p_period_start::text,0\)\)/,
    /on conflict\(award_type,period_start\) do nothing/,
    /on conflict\(award_type,period_start,reviewer_role\) do update[\s\S]*?existing\.reviewer_id=caller/,
    /teamwork_%' and cardinality\(p_contributor_ids\)<2/,
    /p_award_type like 'employee_%' and cardinality\(p_contributor_ids\)<>1/,
    /lower\(u\.email\) ~ '\^\[\^@\]\+@enibrand\[\.\]com\$'/,
    /p_evidence_url is null or p_evidence_url !~ '\^https:\/\//,
    /a\.nomination_id is distinct from b\.nomination_id/,
    /result_kind:='no_award'/,
    /date_trunc\('month', \(now\(\) at time zone 'Africa\/Lagos'\)\)/,
    /p_evidence_date<p_period_start or p_evidence_date>=period_end/,
  ]) assert.match(sql,pattern);
  const forward = source('supabase/migrations/20261121150000_recognition_ceo_publication.sql');
  assert.match(forward,/add column outcome text not null default 'winner'/);
  assert.match(forward,/submit_weekly_recognition_nomination/);
  assert.match(forward,/Only an active CEO can publish recognition/g);
  assert.match(forward,/values\(p_week_start,null,'No award',clean_reason,caller,'no_award'\)/);
  assert.match(forward,/period_recognition_publish/);
  assert.doesNotMatch(forward,/recognition_admin\(\)/);
  assert.match(source('supabase/migrations/20261106001000_recognition_evidence_reviews.sql'),/submit_weekly_recognition_review/);
  assert.match(source('src/app/dashboard/insights/period-actions.ts'),/evidenceDate < target\.period \|\| evidenceDate >= recognitionPeriodEnd/);
  assert.match(source('src/app/dashboard/insights/actions.ts'),/submit_weekly_recognition_review/);
  assert.match(source('src/app/dashboard/insights/actions.ts'),/publish_weekly_recognition/);
  const insights = source('src/app/dashboard/insights/page.tsx');
  assert.doesNotMatch(insights,/weekly_recognition_nominations|weekly_recognition_reviews/);
  assert.match(insights,/query\.archive === "recognition"/);
  assert.match(insights,/Read-only published results from retired weekly and yearly categories/);
  assert.match(source('supabase/checks/period_recognition_preflight.sql'),/to_regclass/);
  const diagnostic = source('supabase/checks/period_recognition_verification.sql');
  assert.match(diagnostic,/to_regprocedure/); assert.match(diagnostic,/procedure_oid/); assert.match(diagnostic,/relation_oid/);
  assert.doesNotMatch(diagnostic,/\bas oid\b/i,'catalog identifiers use explicit aliases');
  assert.match(diagnostic,/pg_get_functiondef\(procedure_oid::(?:pg_catalog\.)?oid\)/);
  const correction = source('supabase/migrations/20261121140000_period_recognition_ceo_nominations.sql');
  const nominationFunction = correction.slice(correction.indexOf('create or replace function public.period_recognition_nominate'), correction.indexOf('\ncommit;'));
  assert.match(nominationFunction,/perform pg_advisory_xact_lock[\s\S]*?if not eba_private\.hub_is_active\(\)/);
  assert.doesNotMatch(nominationFunction,/recognition_admin\(\)/,'nominations remain CEO/Admin');
  assert.match(correction,/create or replace function public\.period_recognition_nominate/);
  assert.match(source('supabase/checks/period_recognition_verification.sql'),/role_gates/);
  const scope = source('supabase/migrations/20261122120000_monthly_recognition_scope.sql');
  assert.match(scope,/employee_month','teamwork_month','most_improved_month/);
  assert.match(scope,/before_date < after_date/);
  assert.match(scope,/p_after_date>=period_end/);
  assert.match(scope,/m\.role='ceo'/);
  assert.match(scope,/pg_advisory_xact_lock/g);
  const workflowFixture=source('supabase/tests/monthly_recognition_workflow.sql');
  assert.match(workflowFixture,/public\.period_recognition_nominate\('employee_month'/);
  assert.match(workflowFixture,/public\.period_recognition_nominate\('teamwork_month'/);
  assert.match(workflowFixture,/public\.period_recognition_nominate\('most_improved_month'/);
  assert.match(workflowFixture,/Admin saw the CEO review before submitting/);
  assert.match(workflowFixture,/Disagreement allowed publication/);
  assert.match(workflowFixture,/Admin direct no-award RPC/);
  assert.match(workflowFixture,/Repeated employee publication created a result/);
  assert.match(workflowFixture,/Retired category accepted a nomination/);
});

test('isolated PostgreSQL integration invokes the actual CEO nomination RPC when a local test database is configured', {
  skip: !process.env.PERIOD_RECOGNITION_TEST_DATABASE_URL || spawnSync('psql',['--version'],{encoding:'utf8'}).status !== 0,
}, () => {
  const databaseUrl = new URL(process.env.PERIOD_RECOGNITION_TEST_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1','::1'].includes(databaseUrl.hostname), 'database test URL must point to loopback only');
  assert.equal(databaseUrl.port,'54322','use the isolated local Supabase database port');
  const sqlFile = path.join(root,'supabase/tests/monthly_recognition_workflow.sql');
  const result = spawnSync('psql',[process.env.PERIOD_RECOGNITION_TEST_DATABASE_URL,'-X','-v','ON_ERROR_STOP=1','-f',sqlFile],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,`PostgreSQL integration failed: ${result.stderr || result.stdout}`);
});

test('isolated PostgreSQL integration executes the validated Most Improved CHECK when a local test database is configured', {
  skip: !process.env.PERIOD_RECOGNITION_TEST_DATABASE_URL || spawnSync('psql',['--version'],{encoding:'utf8'}).status !== 0,
}, () => {
  const databaseUrl = new URL(process.env.PERIOD_RECOGNITION_TEST_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1','::1'].includes(databaseUrl.hostname), 'database test URL must point to loopback only');
  assert.equal(databaseUrl.port,'54322','use the isolated local Supabase database port');
  const sqlFile = path.join(root,'supabase/tests/most_improved_evidence_constraint.sql');
  const result = spawnSync('psql',[process.env.PERIOD_RECOGNITION_TEST_DATABASE_URL,'-X','-v','ON_ERROR_STOP=1','-f',sqlFile],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,`Most Improved CHECK integration failed: ${result.stderr || result.stdout}`);
  for (const label of ['missing before_date','missing after_date','missing before_evidence','missing after_evidence','blank before_evidence','blank after_evidence','reversed dates','valid in-month']) {
    assert.ok((result.stdout+result.stderr).includes(label),`database test output should include ${label}`);
  }
});

test('read-only activity limitation documents missing contribution identity and completion timestamps', () => {
  const sql = source('supabase/migrations/20261106000100_department_plans.sql');
  const page = source('src/app/dashboard/insights/page.tsx');
  assert.match(sql,/owner text not null/); assert.doesNotMatch(sql,/completed_at|completed_by|contributor_id/);
  assert.match(page,/Activity statistics will be available when work tracking is connected/);
  assert.match(page,/Historical plan items have free-text owners and no verified contributor IDs or completion timestamps/);
});

test('Overview shows only the three monthly published result categories', () => {
  const page=source('src/app/dashboard/page.tsx'), helper=source('src/app/dashboard/insights/recognition.ts');
  for (const label of ['Employee of the Month','Best Teamwork','Most Improved Employee']) assert.ok(page.includes(label));
  for (const label of ['Employee of the Week','Employee of the Year','Best Teamwork · Year']) assert.ok(!page.includes(label));
  assert.match(helper,/from\("period_recognition_results"\)/);
  assert.match(helper,/most_improved_month/);
  assert.match(page,/loadPublishedPeriodRecognition\(client, latestCompletedRecognitionPeriod\(\)\)/,'Overview reads the same default completed month as Insights');
  assert.match(helper,/\.eq\("period_start", periodStart\)/,'Overview does not silently select an older result than Insights');
  assert.doesNotMatch(helper,/loadLatestPublishedPeriodRecognition|\.order\("period_start",\s*\{\s*ascending:\s*false\s*\}\)/);
  assert.doesNotMatch(page,/from\("period_recognition_nominations"\)|from\("period_recognition_reviews"\)|weekly_recognition_reviews/);
  assert.match(page,/No award published/); assert.match(page,/No published result/);
  assert.match(page,/overview-recognition--three/);
  assert.ok(page.indexOf('className="overview-game-night"') < page.indexOf('title="Employee Recognition"'), 'Friday Game Night appears before recognition in Overview');
  assert.doesNotMatch(page,/Choose Winner/,'Overview recognition stays view-only');
  assert.match(page,/period_recognition_winner_profiles/);
  assert.match(source('supabase/migrations/20261122130000_recognition_winner_profiles.sql'),/create or replace function public\.period_recognition_winner_profiles/);
  assert.match(source('supabase/migrations/20261122130000_recognition_winner_profiles.sql'),/eba_private\.hub_is_active\(\)/);
  assert.match(source('supabase/migrations/20261122130000_recognition_winner_profiles.sql'),/r\.outcome='winner'/);
});

test('Most Improved repair explicitly rejects nullable evidence and preserves monthly records', () => {
  const repair=source('supabase/migrations/20261122140000_most_improved_evidence_constraint_repair.sql');
  assert.match(repair,/period_recognition_improvement_evidence_check/);
  for(const column of ['before_date','after_date','before_evidence','after_evidence']) assert.match(repair,new RegExp(`${column} is not null`,'i'));
  assert.match(repair,/before_date < after_date/);
  assert.match(repair,/before_date >= period_start/); assert.match(repair,/before_date < \(period_start \+ interval '1 month'\)/);
  assert.match(repair,/after_date >= period_start/); assert.match(repair,/after_date < \(period_start \+ interval '1 month'\)/);
  assert.match(repair,/not valid[\s\S]*validate constraint period_recognition_improvement_evidence_check/i);
  assert.match(repair,/Aggregate counts only/); assert.doesNotMatch(repair,/delete from|update public\.period_recognition_nominations/i);
  const diagnostic=source('supabase/checks/period_recognition_verification.sql');
  assert.match(diagnostic,/conname='period_recognition_improvement_evidence_check'[\s\S]*convalidated/);
  const preflight=source('supabase/checks/most_improved_evidence_preflight.sql');
  assert.match(preflight,/query_to_xml/); assert.match(preflight,/invalid_rows/);
  assert.doesNotMatch(preflight,/insert\s+into|update\s+public|delete\s+from/i);
});

test('combined dashboard diagnostic includes monthly recognition schema without write operations', () => {
  const diagnostic=source('supabase/checks/dashboard_readonly_diagnostic.sql');
  for (const table of ['period_recognition_nominations','period_recognition_reviews','period_recognition_results']) assert.ok(diagnostic.includes(table));
  assert.match(diagnostic,/begin transaction read only/); assert.match(diagnostic,/rollback/);
  assert.doesNotMatch(diagnostic,/insert\s+into|update\s+public|delete\s+from/i);
});
