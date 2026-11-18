import "server-only";
import { createHash } from "node:crypto";
import { calendarAdmin } from "../../app/dashboard/calendar/server";
import { connectionStatus, ConnectionFailure, organizerAccess } from "../google-organizer/server";
import { ProviderFailure } from "../google-organizer/provider";
import { CalendarGoogleProvider, GoogleHttpError } from "./provider";
import { synchronizeClaim, SyncFailure, type Claim, type SyncRepository, type SyncResult } from "./sync";

export function syncRepository(): SyncRepository {
  const client = calendarAdmin();
  if (!client) throw new SyncFailure("setup_required");
  async function control(action: string, claim?: Claim, data: Record<string,unknown> = {}, id?: string) {
    const result = await client!.rpc("calendar_sync_control", { p_action: action,p_id: claim?.meeting.id ?? id ?? null,
      p_lease: claim?.job.lease_token ?? null,p_version: claim?.meeting.version ?? null,p_data: data });
    if (result.error) throw new SyncFailure("setup_required");
    return result.data;
  }
  return {
    claim: async id => await control("claim",undefined,{},id) as Claim | null,
    current: async claim => !!await control("assert",claim),
    bind: async (claim,email,eventId,createAttempt) => !!await control("bind",claim,{ email,event_id: eventId,create_attempt: createAttempt }),
    people: async ids => {
      const result = await client.rpc("calendar_google_people", { p_ids: ids });
      if (result.error) throw new SyncFailure("setup_required");
      return result.data ?? [];
    },
    finish: async (claim,result: SyncResult) => !!await control("finish",claim,result),
  };
}
export async function retryOccurrence(id: string, actorId: string) {
  const client = calendarAdmin();
  if (!client) return false;
  const result = await client.rpc("calendar_sync_control", { p_action: "retry",p_id: id,p_data: { actor: actorId } });
  return !result.error;
}
export async function runCalendarSync(id?: string,budgetMs=85_000) {
  const repo = syncRepository(), email = process.env.GOOGLE_ORGANIZER_EMAIL;
  if (!email) throw new SyncFailure("setup_required");
  const workspace = createHash("sha256").update(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").digest("hex").slice(0,24);
  const deadline = Date.now()+Math.max(1000,Math.min(85_000,budgetMs));
  let cached: Awaited<ReturnType<typeof organizerAccess>> | null = null;
  const access = async () => {
    if (Date.now()>=deadline) throw new SyncFailure("provider_unavailable");
    try {
      if (cached) {
        // A cached access token never bypasses a local disconnect/reconnect.
        const client = calendarAdmin();
        const current = await client?.from("google_organizer_connection").select("enabled,version,email").eq("singleton",true).single();
        if (!current?.data?.enabled || current.data.version !== cached.version || current.data.email !== email) cached = null;
      }
      cached ??= await organizerAccess();
      return cached.accessToken;
    } catch (error) {
      if (error instanceof ProviderFailure && error.kind === "revoked") throw new SyncFailure("reconnect_required");
      if (error instanceof ProviderFailure && error.kind === "permissions") throw new SyncFailure("permission_required");
      if (error instanceof ConnectionFailure) {
        const status = await connectionStatus(false);
        throw new SyncFailure(status.state === "setup_required" ? "setup_required"
          : ["revoked","disconnected"].includes(status.state) ? "reconnect_required" : "provider_unavailable");
      }
      throw new SyncFailure("provider_unavailable");
    }
  };
  const provider = new CalendarGoogleProvider(access,deadline);
  // If Google rejects an otherwise unexpired access token, refresh exactly once
  // through the existing credential flow. No retry of ambiguous writes on 5xx.
  const authenticated = new Proxy(provider, { get(target,key) {
    const method = Reflect.get(target,key);
    if (typeof method !== "function") return method;
    return async (...args: unknown[]) => {
      try { return await method.apply(target,args); }
      catch (error) {
        if (!(error instanceof GoogleHttpError) || error.status !== 401) throw error;
        cached = null; await access();
        try { return await method.apply(target,args); }
        catch (retryError) { if (retryError instanceof GoogleHttpError && retryError.status === 401) throw new SyncFailure("reconnect_required"); throw retryError; }
      }
    };
  } });
  let processed = 0, recorded = 0;
  while (processed<(id ? 1 : 5) && Date.now()<deadline) {
    const claim = await repo.claim(id);
    if (!claim) break;
    processed++;
    if (await synchronizeClaim(repo,authenticated,claim,email,workspace)) recorded++;
  }
  // Counts reveal no titles, attendee addresses, provider IDs or token details.
  return { processed, recorded };
}
