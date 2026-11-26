import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createStaffClient, getStaffRole } from "../staff-auth";
import { decrypt, encrypt, encryptionKey, hash, randomSecret } from "./crypto";
import { calendarSupportsMeet, googleClient, googleScopes, callEndingScope, isRevoked, libraryReady, ProviderFailure, revokeToken, scopesGranted } from "./provider";

export const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export const flowCookie = process.env.NODE_ENV === "production" ? "__Secure-eba-google-flow" : "eba-google-flow";
export const flowCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/api/google", maxAge: 600 };
export type Notice = "connected" | "denied" | "expired" | "mismatch" | "refresh_missing" | "permissions" | "unavailable" | "disconnected" | "revocation_failed" | "forbidden";
export const notices: Record<Notice, string> = {
  connected: "Google authorization and encrypted credential storage succeeded.",
  denied: "Google authorization was declined. No connection was changed.",
  expired: "This authorization attempt expired or was already used. Start again from Settings.",
  mismatch: "The Google account did not match the configured organizer. No connection was changed.",
  refresh_missing: "Google did not issue offline access. Reconnect and grant all requested permissions.",
  permissions: "Google could not confirm all required permissions. Check consent and Google API configuration, then reconnect.",
  unavailable: "Google connection could not be completed. Check server setup and try again.",
  disconnected: "Local access is disabled. Google access was revoked or was already invalid.",
  revocation_failed: "Local access is disabled, but Google revocation could not be confirmed. Remove the app from the organizer’s Google account permissions.",
  forbidden: "Only an active Admin can manage the organizer connection.",
};
export class ConnectionFailure extends Error {
  constructor(public notice: Notice, public diagnosticCode?: string, public missingVariables?: string[]) { super(notice); }
}
export type GoogleStatus = {
  state: "setup_required" | "unavailable" | "disconnected" | "connected" | "revoked" | "verification_failed";
  email: string | null; meetSupported: boolean | null; verifiedAt: string | null; revocationFailed: boolean;
  diagnosticCode?: string;
  missingVariables?: string[];
};
type Connection = { version: number; email: string | null; subject: string | null; refresh_ciphertext: string | null;
  enabled: boolean; status: string; meet_supported: boolean | null; verified_at: string | null; revocation_failed: boolean };
type Flow = { state_hash: string; organizer_email: string; version: number; verifier_ciphertext: string; nonce: string };
export async function googleActor(adminOnly = false) {
  const client = await createStaffClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const role = await getStaffRole(client, data.user);
  if (!role || (adminOnly && role !== "Admin")) return null;


  const claims = await client.auth.getClaims();
  const session = claims.data?.claims.session_id;
  if (claims.error || typeof session !== "string" || claims.data?.claims.sub !== data.user.id) return null;
  return { id: data.user.id, session, role };
}
type Actor = NonNullable<Awaited<ReturnType<typeof googleActor>>>;
function database() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean) as string[];
  if (missing.length) throw new ConnectionFailure("unavailable", "SUPABASE_CONFIGURATION_MISSING", missing);
  if (!url || !key) throw new ConnectionFailure("unavailable", "SUPABASE_CONFIGURATION_MISSING");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function googleConfig() {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_REDIRECT_URI, email = process.env.GOOGLE_ORGANIZER_EMAIL;
  const missing = [!id && "GOOGLE_CLIENT_ID", !secret && "GOOGLE_CLIENT_SECRET", !redirect && "GOOGLE_REDIRECT_URI", !email && "GOOGLE_ORGANIZER_EMAIL", !process.env.GOOGLE_TOKEN_ENCRYPTION_KEY && "GOOGLE_TOKEN_ENCRYPTION_KEY"].filter(Boolean) as string[];
  if (missing.length) throw new ConnectionFailure("unavailable", "GOOGLE_CONFIGURATION_MISSING", missing);
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new ConnectionFailure("unavailable", "GOOGLE_ORGANIZER_EMAIL_INVALID");
  let url: URL;
  try { url = new URL(redirect!); } catch { throw new ConnectionFailure("unavailable", "GOOGLE_REDIRECT_URI_INVALID"); }
  if (url.pathname !== "/api/google/callback" || url.search || url.hash || url.username || url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost" && process.env.NODE_ENV !== "production"))) throw new ConnectionFailure("unavailable", "GOOGLE_REDIRECT_URI_INVALID");
  try { encryptionKey(); } catch { throw new ConnectionFailure("unavailable", "GOOGLE_TOKEN_ENCRYPTION_KEY_INVALID"); }
  if (!libraryReady()) throw new ConnectionFailure("unavailable", "GOOGLE_AUTH_LIBRARY_MISSING");
  return { id: id!, secret: secret!, redirect: redirect!, email, origin: url.origin };
}
export function sameOrigin(request: Request) {

  try { return request.headers.get("origin") === new URL(process.env.GOOGLE_REDIRECT_URI ?? "").origin; } catch { return false; }
}
export function settingsRedirect(notice: Notice) {
  try {
    const callback = new URL(process.env.GOOGLE_REDIRECT_URI ?? "");
    if (callback.username || callback.password || !["http:", "https:"].includes(callback.protocol)) return null;
    return new URL(`/dashboard/settings?google=${notice}`, callback.origin);
  } catch { return null; }
}
async function rpc(action: string, actor: Actor, data: Record<string, unknown>) {
  const result = await database().rpc("google_organizer_authorize", { p_action: action, p_admin: actor.id, p_session: actor.session, p_data: data });
  if (result.error || !result.data) throw new ConnectionFailure(action === "consume" || action === "save" ? "expired" : "unavailable");
  return result.data;
}
async function readConnection(): Promise<Connection> {
  const { data, error } = await database().from("google_organizer_connection").select("version,email,subject,refresh_ciphertext,enabled,status,meet_supported,verified_at,revocation_failed").eq("singleton", true).single();
  if (error) throw new ConnectionFailure("unavailable", safeDatabaseCode(error.code) ?? "GOOGLE_CONNECTION_LOOKUP_FAILED");
  if (!data) throw new ConnectionFailure("unavailable", "GOOGLE_CONNECTION_ROW_MISSING");
  return data;
}
type ConnectionStatusRow = Pick<Connection, "email" | "enabled" | "status" | "meet_supported" | "verified_at" | "revocation_failed">;
function safeDatabaseCode(code: unknown) {
  return typeof code === "string" && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/.test(code) ? code : null;
}
async function readConnectionStatus(): Promise<ConnectionStatusRow> {
  const { data, error } = await database().from("google_organizer_connection")
    .select("email,enabled,status,meet_supported,verified_at,revocation_failed").eq("singleton", true).single();
  if (error) throw new ConnectionFailure("unavailable", safeDatabaseCode(error.code) ?? "GOOGLE_CONNECTION_LOOKUP_FAILED");
  if (!data) throw new ConnectionFailure("unavailable", "GOOGLE_CONNECTION_ROW_MISSING");
  return data;
}
export async function beginAuthorization(actor: Actor) {
  if (actor.role !== "Admin") throw new ConnectionFailure("forbidden");
  const config = googleConfig(), state = randomSecret(), browser = randomSecret(), verifier = randomSecret(), nonce = randomSecret();
  await rpc("start", actor, { state_hash: hash(state), browser_hash: hash(browser), email: config.email,
    verifier: encrypt(verifier, `pkce:${hash(state)}`), nonce });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.id, redirect_uri: config.redirect, response_type: "code", access_type: "offline",
    prompt: "consent select_account", scope: [...googleScopes,...(process.env.GOOGLE_MEET_CALL_ENDING_ENABLED==="true"?[callEndingScope]:[])].join(" "), state, nonce,
    code_challenge: hash(verifier), code_challenge_method: "S256" }).toString();
  (await cookies()).set(flowCookie, browser, flowCookieOptions);
  return url.toString();
}
export async function finishAuthorization(actor: Actor, parameters: URLSearchParams) {
  if (actor.role !== "Admin") throw new ConnectionFailure("forbidden");
  const config = googleConfig(), store = await cookies(), browser = store.get(flowCookie)?.value;
  const state = parameters.get("state");
  store.set(flowCookie, "", { ...flowCookieOptions, maxAge: 0 });
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !browser || parameters.getAll("state").length !== 1) throw new ConnectionFailure("expired");
  const flow = await rpc("consume", actor, { state_hash: hash(state), browser_hash: hash(browser) }) as Flow;
  if (flow.organizer_email !== config.email) throw new ConnectionFailure("expired");
  if (parameters.has("error")) throw new ConnectionFailure(parameters.get("error") === "access_denied" ? "denied" : "unavailable");
  const code = parameters.get("code");
  if (!code || code.length > 4096 || parameters.getAll("code").length !== 1) throw new ConnectionFailure("expired");
  const oauth = googleClient(config);
  const { tokens } = await oauth.getToken({ code, codeVerifier: decrypt(flow.verifier_ciphertext, `pkce:${flow.state_hash}`) });
  if (!tokens.id_token || !tokens.access_token) throw new ConnectionFailure("permissions");
  const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.id });
  const identity = ticket.getPayload();
  if (!identity?.sub || identity.email_verified !== true || identity.email !== config.email || identity.nonce !== flow.nonce) throw new ConnectionFailure("mismatch");
  if (!scopesGranted(tokens.scope)) throw new ConnectionFailure("permissions");
  const previous = await readConnection();
  const refresh = tokens.refresh_token || (previous.enabled && previous.email === config.email && previous.subject === identity.sub && previous.refresh_ciphertext
    ? decrypt(previous.refresh_ciphertext, `refresh:${config.email}:${identity.sub}`) : null);
  if (!refresh) throw new ConnectionFailure("refresh_missing");


  oauth.setCredentials({ refresh_token: refresh });
  const refreshed = (await oauth.refreshAccessToken()).credentials;
  if (!refreshed.access_token) throw new ConnectionFailure("refresh_missing");
  const info = await oauth.getTokenInfo(refreshed.access_token);
  if (info.aud !== config.id || !scopesGranted(info.scopes.join(" "))) throw new ConnectionFailure("permissions");
  const meet = await calendarSupportsMeet(refreshed.access_token);
  await rpc("save", actor, { state_hash: flow.state_hash, email: identity.email, subject: identity.sub,
    ciphertext: encrypt(refreshed.refresh_token || refresh, `refresh:${config.email}:${identity.sub}`), meet_supported: meet });
}




export async function organizerAccess() {
  const config = googleConfig(), current = await readConnection();
  if (!current.enabled || current.email !== config.email || !current.subject || !current.refresh_ciphertext) throw new ConnectionFailure("unavailable");
  try {
    const oauth = googleClient(config);
    oauth.setCredentials({ refresh_token: decrypt(current.refresh_ciphertext, `refresh:${config.email}:${current.subject}`) });
    const { credentials } = await oauth.refreshAccessToken();
    if (!credentials.access_token) throw new ProviderFailure("unavailable");
    const info = await oauth.getTokenInfo(credentials.access_token);
    if (info.aud !== config.id || !scopesGranted(info.scopes.join(" "))) throw new ProviderFailure("permissions");
    const latest = await readConnection();
    if (!latest.enabled || latest.version !== current.version) throw new ConnectionFailure("expired");
    if (credentials.refresh_token) {
      const saved = await database().from("google_organizer_connection").update({
        refresh_ciphertext: encrypt(credentials.refresh_token, `refresh:${config.email}:${current.subject}`),
      }).eq("singleton", true).eq("version", current.version).eq("enabled", true).select("version").single();
      if (saved.error || !saved.data) throw new ConnectionFailure("expired");
    }
    return { accessToken: credentials.access_token, version: current.version,callEndingAuthorized:info.scopes.includes(callEndingScope) };
  } catch (error) {
    if (isRevoked(error)) {
      await database().from("google_organizer_connection").update({ status: "revoked", enabled: false, refresh_ciphertext: null, meet_supported: null })
        .eq("singleton", true).eq("version", current.version);
      throw new ProviderFailure("revoked");
    }
    throw error;
  }
}
export async function connectionStatus(check = false): Promise<GoogleStatus> {
  const empty = { email: null, meetSupported: null, verifiedAt: null, revocationFailed: false };
  try { googleConfig(); } catch (error) {
    const failure = error instanceof ConnectionFailure ? error : null;
    return { ...empty, state: "setup_required", diagnosticCode: failure?.diagnosticCode ?? "GOOGLE_CONFIGURATION_INVALID", missingVariables: failure?.missingVariables };
  }
  try {
    let row: ConnectionStatusRow | Connection = check ? await readConnection() : await readConnectionStatus();
    if (row.email && row.email !== process.env.GOOGLE_ORGANIZER_EMAIL) return { ...empty, state: "setup_required", diagnosticCode: "GOOGLE_ORGANIZER_IDENTITY_MISMATCH" };
    if (row.enabled && check) {
      try {
        const access = await organizerAccess(), meet = await calendarSupportsMeet(access.accessToken);
        const verified = await database().from("google_organizer_connection").update({ meet_supported: meet, verified_at: new Date().toISOString(), status: "connected" })
          .eq("singleton", true).eq("enabled", true).eq("version", access.version);
        if (verified.error) throw new ProviderFailure("unavailable");
        row = await readConnection();
      } catch {
        row = await readConnection();
        if (row.enabled) return { ...empty, email: row.email, verifiedAt: row.verified_at, state: "verification_failed" };
      }
    }
    return { state: row.enabled ? "connected" : row.status === "revoked" ? "revoked" : "disconnected",
      email: row.email, meetSupported: row.enabled ? row.meet_supported : null, verifiedAt: row.verified_at, revocationFailed: row.revocation_failed };
  } catch (error) {
    const failure = error instanceof ConnectionFailure ? error : null;
    return { ...empty, state: "unavailable", diagnosticCode: failure?.diagnosticCode ?? "GOOGLE_STATUS_LOOKUP_FAILED", missingVariables: failure?.missingVariables };
  }
}
export async function disconnectOrganizer(actor: Actor): Promise<Notice> {
  if (actor.role !== "Admin") throw new ConnectionFailure("forbidden");

  const old = await rpc("disconnect", actor, {}) as Connection;
  let revoked = !old.refresh_ciphertext;
  if (old.refresh_ciphertext && old.email && old.subject) {
    try { revoked = await revokeToken(decrypt(old.refresh_ciphertext, `refresh:${old.email}:${old.subject}`)); } catch { revoked = false; }
  }
  const result = await database().from("google_organizer_connection").update({ revocation_failed: !revoked })
    .eq("singleton", true).eq("version", old.version + 1).eq("enabled", false);
  if (result.error || !revoked) return "revocation_failed";
  return "disconnected";
}
export function safeNotice(error: unknown): Notice {
  return error instanceof ConnectionFailure ? error.notice : error instanceof ProviderFailure && error.kind === "permissions" ? "permissions" : "unavailable";
}
