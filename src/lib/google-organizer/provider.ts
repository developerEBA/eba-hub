import "server-only";
import { createRequire } from "node:module";

export const googleScopes = [
  "openid", "email",
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.calendars.readonly",
  "https://www.googleapis.com/auth/meetings.space.settings",
];
export const callEndingScope="https://www.googleapis.com/auth/meetings.space.created";
type Tokens = { access_token?: string | null; refresh_token?: string | null; id_token?: string | null; scope?: string };
type Identity = { sub?: string; email?: string; email_verified?: boolean; nonce?: string };
type GoogleClient = {
  getToken(options: { code: string; codeVerifier: string }): Promise<{ tokens: Tokens }>;
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): Identity | undefined }>;
  setCredentials(tokens: Tokens): void;
  refreshAccessToken(): Promise<{ credentials: Tokens }>;
  getTokenInfo(accessToken: string): Promise<{ aud: string; scopes: string[] }>;
};



const serverRequire = createRequire(import.meta.url);
export function googleClient(config: { id: string; secret: string; redirect: string }): GoogleClient {
  const { OAuth2Client } = serverRequire("google-auth-library") as {
    OAuth2Client: new (options: { clientId: string; clientSecret: string; redirectUri: string; transporterOptions: { timeout: number } }) => GoogleClient;
  };
  return new OAuth2Client({ clientId: config.id, clientSecret: config.secret, redirectUri: config.redirect, transporterOptions: { timeout: 12_000 } });
}
export function libraryReady() { try { serverRequire.resolve("google-auth-library"); return true; } catch { return false; } }
export function scopesGranted(scope: string | undefined) {
  const granted = new Set((scope ?? "").split(/\s+/));
  return googleScopes.every(s => granted.has(s) || (s === "email" && granted.has("https://www.googleapis.com/auth/userinfo.email")));
}
export class ProviderFailure extends Error {
  constructor(public kind: "revoked" | "unavailable" | "permissions") { super(kind); }
}
export function isRevoked(error: unknown) {

  const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error === "invalid_grant";
}
export async function calendarSupportsMeet(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary?fields=id,conferenceProperties", {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new ProviderFailure(response.status === 401 ? "revoked" : response.status === 403 ? "permissions" : "unavailable");
  const calendar = await response.json() as { conferenceProperties?: { allowedConferenceSolutionTypes?: string[] } };
  return calendar.conferenceProperties?.allowedConferenceSolutionTypes?.includes("hangoutsMeet") === true;
}
export async function revokeToken(token: string) {
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }), cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (response.ok) return true;
    if (response.status === 400) {
      const body = await response.json() as { error?: string };
      return body.error === "invalid_token";
    }
  } catch {  }
  return false;
}
