import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runLocalCalendarWorker, workerUrl, intervalMs, requestTimeoutMs } from "./calendar-worker.mjs";


const secret = "fixture-worker-secret-32-characters-minimum";
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = (data = { processed: 1, recorded: 1 }, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function clock() {
  let now = 0, next = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout(fn, delay) { const id = ++next; pending.set(id, { fn, at: now + delay, delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const first = [...pending].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
        if (!first) break;
        now = first[1].at; pending.delete(first[0]); first[1].fn();
      }
      now = end;
    },
  };
}
function harness(fetchImpl) {
  const stop = new AbortController(), timers = clock(), logs = [];
  const finished = runLocalCalendarWorker({ secret, signal: stop.signal, timers, fetchImpl, log: message => logs.push(message) });
  return { stop, timers, logs, finished };
}
function assertSafe(logs) {
  const text = logs.join("\n");
  for (const privateValue of [secret, "PRIVATE_MEETING", "Authorization", "Bearer "]) assert(!text.includes(privateValue), "Worker logs exposed fixture private data");
}

test("Starts immediately with a fixed local POST and waits for the response body before the next delay", async () => {
  let calls = 0, releaseBody;
  const body = new Promise(resolve => { releaseBody = resolve; });
  const h = harness(async (url, options) => {
    calls++;
    assert.equal(url, "http://localhost:3000/api/calendar/sync");
    assert.equal(url, workerUrl); assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    assert(options.headers.Authorization === `Bearer ${secret}`, "Missing bearer credential");
    return calls === 1 ? { ...response(), json: () => body } : response({ processed: 0, recorded: 0 });
  });
  assert.equal(calls, 1);
  await settle();
  h.timers.tick(60_000); await settle(); assert.equal(calls, 1, "Requests overlapped while a body was pending");
  releaseBody({ processed: 3, recorded: 2, meeting: "PRIVATE_MEETING" }); await settle();
  assert(h.logs.some(line => line.includes("processed=3 recorded=2")));
  h.timers.tick(intervalMs - 1); await settle(); assert.equal(calls, 1);
  h.timers.tick(1); await settle(); assert.equal(calls, 2);
  h.stop.abort(); await h.finished; assert.equal(h.timers.pending.size, 0); assertSafe(h.logs);
});

test("Temporary connection errors, non-2xx and malformed responses do not stop later requests", async () => {
  let calls = 0, cancelled = false;
  const h = harness(async () => {
    calls++;
    if (calls === 1) throw Error(`Network error with Authorization Bearer ${secret}`);
    if (calls === 2) return { ...response(null, 503), body: { cancel: async () => { cancelled = true; } }, json: async () => { throw Error("Error bodies must not be read"); } };
    if (calls === 3) return { ...response(null, 403), statusText: secret };
    if (calls === 4) return { ...response(), json: async () => { throw Error(secret); } };
    return response({ processed: 2, recorded: 1, details: "PRIVATE_MEETING", token: secret });
  });
  await settle();
  for (let attempt = 0; attempt < 4; attempt++) { h.timers.tick(intervalMs); await settle(); }
  assert.equal(calls, 5); assert(cancelled);
  assert(h.logs.some(line => line.includes("HTTP 503"))); assert(h.logs.some(line => line.includes("HTTP 403")));
  assert(h.logs.some(line => line.includes("processed=2 recorded=1")));
  h.stop.abort(); await h.finished; assertSafe(h.logs);
});

test("150-second request timeout aborts a hung request, then retries without overlap", async () => {
  let calls = 0, active = 0, peak = 0;
  const h = harness(async (_url, { signal }) => {
    calls++; active++; peak = Math.max(peak, active);
    try {
      if (calls === 1) await new Promise((_, reject) => signal.addEventListener("abort", () => reject(Error(secret)), { once: true }));
      return response();
    } finally { active--; }
  });
  assert(requestTimeoutMs >= 120_000);
  h.timers.tick(requestTimeoutMs - 1); await settle(); assert.equal(calls, 1); assert.equal(active, 1);
  h.timers.tick(1); await settle(); assert.equal(active, 0);
  assert(h.logs.some(line => line.includes("timed out after 150s")));
  h.timers.tick(intervalMs); await settle(); assert.equal(calls, 2); assert.equal(peak, 1);
  h.stop.abort(); await h.finished; assert.equal(h.timers.pending.size, 0); assertSafe(h.logs);
});

test("Stop aborts an in-flight request and never starts another", async () => {
  let calls = 0, requestSignal;
  const h = harness((_url, { signal }) => {
    calls++; requestSignal = signal;
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(Error("stopped")), { once: true }));
  });
  h.stop.abort(); await h.finished;
  assert(requestSignal.aborted); h.timers.tick(600_000); await settle(); assert.equal(calls, 1);
  assert.equal(h.timers.pending.size, 0); assert.equal(h.logs.filter(line => line.endsWith("Stopped.")).length, 1); assertSafe(h.logs);
});

test("Logs only valid numeric counts, never reflected response payloads", async () => {
  const h = harness(async () => response({ processed: secret, recorded: "PRIVATE_MEETING", Authorization: secret }));
  await settle(); h.stop.abort(); await h.finished;
  assert(h.logs.some(line => line.includes("processing counts unavailable"))); assertSafe(h.logs);
});

test("Reminder logs include aggregate counts only and reject reflected fields", async () => {
  let h = harness(async () => response({processed:0,recorded:0,reminders:{available:true,delivered:2,skipped:3,checked:1,title:"PRIVATE_MEETING",token:secret}}));
  await settle();h.stop.abort();await h.finished;
  assert(h.logs.some(line=>line.includes("delivered=2 skipped=3 checked=1")));assertSafe(h.logs);
  h = harness(async () => response({processed:0,recorded:0,reminders:{available:true,delivered:secret,skipped:3,checked:1}}));
  await settle();h.stop.abort();await h.finished;assertSafe(h.logs);
});

test("Environment loading reads a fixture .env.local, fails clearly when missing, and blocks production", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "eba-calendar-worker-test-"));
  const script = fileURLToPath(new URL("./calendar-worker.mjs", import.meta.url));
  const env = { ...process.env, NODE_ENV: "development" };
  delete env.CALENDAR_SYNC_SECRET; delete env.__NEXT_PROCESSED_ENV; delete env.VERCEL;

  const source = `import {loadLocalConfiguration} from ${JSON.stringify(pathToFileURL(script).href)};
    try { const config=loadLocalConfiguration(process.argv[1]); process.stdout.write(config.secret===${JSON.stringify(secret)}?'loaded':'unexpected'); }
    catch(error) { process.stderr.write(error.message); process.exitCode=1; }`;
  const load = () => spawnSync(process.execPath, ["--input-type=module", "-e", source, directory], { env, encoding: "utf8" });
  try {
    let result = load(); assert.equal(result.status, 1); assert(result.stderr.includes(".env.local is missing"));
    writeFileSync(path.join(directory, ".env.local"), "UNRELATED=fixture\n");
    result = load(); assert.equal(result.status, 1); assert(result.stderr.includes("CALENDAR_SYNC_SECRET is missing"));
    writeFileSync(path.join(directory, ".env.local"), "CALENDAR_SYNC_SECRET=YOUR_RANDOM_SERVER_ONLY_WORKER_SECRET\n");
    result = load(); assert.equal(result.status, 1); assert(result.stderr.includes("example placeholder"));
    writeFileSync(path.join(directory, ".env.local"), `CALENDAR_SYNC_SECRET="${secret}"\n`);
    result = load(); assert.equal(result.status, 0); assert.equal(result.stdout, "loaded");
    const production = spawnSync(process.execPath, [script], { env: { ...env, NODE_ENV: "production" }, encoding: "utf8" });
    assert.equal(production.status, 1); assert(production.stderr.includes("local development only"));
    assert(!production.stdout.includes(secret)); assert(!production.stderr.includes(secret));
  } finally {

    rmSync(path.join(directory, ".env.local"), { force: true });
    rmdirSync(directory);
  }
});
