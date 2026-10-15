import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

export const AUTH_ISSUER = "https://auth.openai.com";
export const AUTHORIZE_URL = `${AUTH_ISSUER}/api/accounts/authorize`;
export const TOKEN_URL = `${AUTH_ISSUER}/api/accounts/oauth/token`;
export const REVOKE_URL = `${AUTH_ISSUER}/api/accounts/oauth/revoke`;
export const JWKS_URL = `${AUTH_ISSUER}/.well-known/jwks.json`;
export const RESOURCE = "https://api.openai.com/v1";
export const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
export const AGENT_NAME = "GeminiHall";
export const CALLBACK_PATH = "/auth/callback";
export const CHATGPT_USAGE_URL = "https://chatgpt.com/";

export const TERMINAL_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

export function pickPort(): number {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return 20000 + (n % 40000);
}

export interface AuthorizeParams {
  clientId: string | null;
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  loginHint?: string;
  forceConsent?: boolean;
}

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const q = new URLSearchParams();
  const registering = !p.clientId;
  q.set("client_id", p.clientId ?? REGISTRATION_CLIENT_ID);
  if (registering) q.set("agent_name_hint", AGENT_NAME);
  q.set("ext_agent_host_id", p.hostId);
  if (!registering && p.loginHint) q.set("login_hint", p.loginHint);
  q.set("response_type", "code");
  q.set("redirect_uri", p.redirectUri);
  q.set("scope", SCOPES);
  q.set("resource", RESOURCE);
  q.set("state", p.state);
  q.set("nonce", p.nonce);
  q.set("code_challenge_method", "S256");
  q.set("code_challenge", p.codeChallenge);
  if (p.forceConsent) q.set("prompt", "consent");
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

export interface CallbackResult {
  code: string | null;
  state: string | null;
  clientId: string | null;
  scope: string | null;
  error: string | null;
}

export function parseCallback(search: string): CallbackResult {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    code: q.get("code"),
    state: q.get("state"),
    clientId: q.get("client_id"),
    scope: q.get("scope"),
    error: q.get("error"),
  };
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`oauth error: ${code} (${status})`);
    this.name = "OAuthError";
  }
}

async function postForm(url: string, form: Record<string, string>, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

async function tokenRequest(form: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await postForm(TOKEN_URL, form, fetchImpl);
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string };
  if (!res.ok || !body.access_token) throw new OAuthError(body.error ?? "token_request_failed", res.status);
  return body as TokenResponse;
}

export function exchangeCode(
  args: { clientId: string; code: string; verifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      client_id: args.clientId,
      code: args.code,
      code_verifier: args.verifier,
      redirect_uri: args.redirectUri,
      resource: RESOURCE,
    },
    fetchImpl,
  );
}

export function refreshTokens(
  args: { clientId: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return tokenRequest(
    { grant_type: "refresh_token", client_id: args.clientId, refresh_token: args.refreshToken, resource: RESOURCE },
    fetchImpl,
  );
}

export async function revokeRefreshToken(
  args: { clientId: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await postForm(
    REVOKE_URL,
    { token: args.refreshToken, token_type_hint: "refresh_token", client_id: args.clientId },
    fetchImpl,
  );
  return res.ok;
}

export function grantedScopes(scope: string | undefined | null): Set<string> {
  return new Set((scope ?? "").split(/\s+/u).filter(Boolean));
}

export function hasPlanScope(scope: string | undefined | null): boolean {
  return grantedScopes(scope).has(PLAN_SCOPE);
}

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function validateIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
  jwks?: JSONWebKeySet,
): Promise<{ sub: string; email: string | null }> {
  const keySet = jwks ? createLocalJWKSet(jwks) : (remoteJwks ??= createRemoteJWKSet(new URL(JWKS_URL)));
  const { payload } = await jwtVerify(idToken, keySet, { issuer: AUTH_ISSUER, audience: expected.clientId });
  if (payload.nonce !== expected.nonce) throw new OAuthError("nonce_mismatch", 0);
  if (typeof payload.sub !== "string" || !payload.sub) throw new OAuthError("missing_subject", 0);
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

export interface PlanModel {
  slug: string;
  displayName: string;
}

export async function listPlanModels(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<PlanModel[]> {
  const res = await fetchImpl(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new OAuthError("models_request_failed", res.status);
  const body = (await res.json()) as { models?: { slug?: string; display_name?: string; visibility?: string }[] };
  return (body.models ?? [])
    .filter((m) => m.visibility === "list" && typeof m.slug === "string")
    .map((m) => ({ slug: m.slug!, displayName: m.display_name ?? m.slug! }));
}
