
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

export const workerUrl = "http://localhost:3000/api/calendar/sync";
export const intervalMs = 60_000;
export const requestTimeoutMs = 150_000;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class WorkerConfigurationError extends Error {}
function requireDevelopment() {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "development") {
    throw new WorkerConfigurationError("This worker is for local development only. Use a deployed scheduler in production.");
  }
  if (process.env.VERCEL === "1") {
    throw new WorkerConfigurationError("This worker must run locally, not in a deployed environment.");
  }
}
function validateSecret(secret) {
  if (!secret) throw new WorkerConfigurationError("CALENDAR_SYNC_SECRET is missing. Configure it in .env.local and restart the worker.");
  if (secret.length < 32 || secret !== secret.trim() || /[\r\n]/.test(secret) || secret === "YOUR_RANDOM_SERVER_ONLY_WORKER_SECRET") {
    throw new WorkerConfigurationError("CALENDAR_SYNC_SECRET must be at least 32 characters, without surrounding whitespace or line breaks, and must not be the example placeholder.");
  }
}
export function loadLocalConfiguration(directory = projectRoot) {
  requireDevelopment();
  if (!existsSync(path.join(directory, ".env.local"))) {
    throw new WorkerConfigurationError(".env.local is missing. Configure CALENDAR_SYNC_SECRET there before starting this worker.");
  }
  let failed = false;


  try { nextEnv.loadEnvConfig(directory, true, { info() {}, error() { failed = true; } }); }
  catch { failed = true; }
  if (failed) throw new WorkerConfigurationError("Could not load the local environment. Check .env.local without sharing its contents.");
  requireDevelopment();
  const secret = process.env.CALENDAR_SYNC_SECRET;
  validateSecret(secret);
  return { secret };
}

function pause(signal, timers) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { timers.clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = timers.setTimeout(done, intervalMs);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}
function counts(data) {
  const ending=data?.call_ending;
  const calls=ending && [ending.processed,ending.ended].every(n=>Number.isSafeInteger(n)&&n>=0)&&ending.ended<=ending.processed
    ? ` call_ending=${ending.available===true?"available":"unavailable"} ended=${ending.ended}` : "";
  const imported=data?.google_import;
  const incoming=imported && Number.isSafeInteger(imported.imported) && imported.imported>=0
    ? ` google_import=${imported.available===true?"available":"unavailable"} imported=${imported.imported}` : "";
  const r=data?.reminders;
  const extra=r && [r.delivered,r.skipped,r.checked].every(n=>Number.isSafeInteger(n)&&n>=0)
    ? ` reminders=${r.available===true?"available":"unavailable"} delivered=${r.delivered} skipped=${r.skipped} checked=${r.checked}` : "";
  const { processed, recorded } = data ?? {};
  return Number.isSafeInteger(processed) && processed >= 0 && Number.isSafeInteger(recorded) && recorded >= 0 && recorded <= processed
    ? `processed=${processed} recorded=${recorded}${extra}${incoming}${calls}` : "processing counts unavailable";
}



export async function runLocalCalendarWorker({ secret, signal, fetchImpl = globalThis.fetch, log = console.log, timers = { setTimeout, clearTimeout } }) {
  requireDevelopment();
  validateSecret(secret);
  log("[calendar-worker] Local worker started. Queued jobs may create real Google events, invitations, private reminders and end eligible active calls.");
  try {
    while (!signal.aborted) {
      const controller = new AbortController();
      let timedOut = false;
      const stopRequest = () => controller.abort();
      signal.addEventListener("abort", stopRequest, { once: true });
      const timeout = timers.setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
      try {
        if (signal.aborted) break;
        const response = await fetchImpl(workerUrl, {
          method: "POST", headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
          redirect: "error", cache: "no-store", signal: controller.signal,
        });
        if (signal.aborted) break;
        if (!response.ok) {


          await response.body?.cancel().catch(() => {});
          const hint = [401,403].includes(response.status) ? " Check that the local server and worker use the same secret." : "";
          log(`[calendar-worker] HTTP ${response.status}; retrying after 60s.${hint}`);
        } else {
          const data = await response.json();
          if (!signal.aborted) log(`[calendar-worker] HTTP ${response.status}; ${counts(data)}.`);
        }
      } catch {
        if (!signal.aborted) log(timedOut
          ? "[calendar-worker] Request timed out after 150s; retrying after 60s."
          : "[calendar-worker] Request or response failed; check the local server. Retrying after 60s.");
      } finally {
        timers.clearTimeout(timeout);
        signal.removeEventListener("abort", stopRequest);
      }


      if (!signal.aborted) await pause(signal, timers);
    }
  } finally {
    log("[calendar-worker] Stopped.");
  }
}

export async function main() {
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    if (process.argv.length > 2) throw new WorkerConfigurationError("No command-line options are supported. This worker only targets localhost:3000.");
    const { secret } = loadLocalConfiguration();
    await runLocalCalendarWorker({ secret, signal: stop.signal });
  } catch (error) {
    console.error("[calendar-worker] " + (error instanceof WorkerConfigurationError ? error.message : "Worker could not start. Check local configuration."));
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
