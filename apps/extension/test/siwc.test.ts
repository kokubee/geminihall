import { describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  AUTH_ISSUER,
  OAuthError,
  buildAuthorizeUrl,
  exchangeCode,
  hasPlanScope,
  listPlanModels,
  loopbackRedirectUri,
  parseCallback,
  pkceChallenge,
  refreshTokens,
  validateIdToken,
} from "../lib/siwc";

describe("PKCE", () => {
  it("matches the RFC 7636 example", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("authorize URL", () => {
  const base = { hostId: "urn:uuid:h", redirectUri: loopbackRedirectUri(43210), state: "s", nonce: "n", codeChallenge: "c" };

  it("registers with dynamic_agent_client and the agent name", () => {
    const u = new URL(buildAuthorizeUrl({ ...base, clientId: null, loginHint: "a@example.com" }));
    expect(u.origin + u.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(u.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(u.searchParams.get("agent_name_hint")).toBe("GeminiHall");
    expect(u.searchParams.get("login_hint")).toBeNull();
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43210/auth/callback");
    expect(u.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
    expect(u.searchParams.get("resource")).toBe("https://api.openai.com/v1");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("ext_agent_host_id")).toBe("urn:uuid:h");
  });

  it("reauthorizes with the issued client id and no agent name", () => {
    const u = new URL(buildAuthorizeUrl({ ...base, clientId: "oaiapp_123", loginHint: "a@example.com" }));
    expect(u.searchParams.get("client_id")).toBe("oaiapp_123");
    expect(u.searchParams.get("agent_name_hint")).toBeNull();
    expect(u.searchParams.get("login_hint")).toBe("a@example.com");
  });
});

describe("callback parsing and scopes", () => {
  it("reads code, state, client id and scope", () => {
    const r = parseCallback("?code=abc&scope=chatgpt.tokens.use.direct+email+openid&state=s1&client_id=oaiapp_9");
    expect(r).toEqual({ code: "abc", state: "s1", clientId: "oaiapp_9", scope: "chatgpt.tokens.use.direct email openid", error: null });
    expect(hasPlanScope(r.scope)).toBe(true);
    expect(hasPlanScope("openid email")).toBe(false);
    expect(parseCallback("error=access_denied&state=s").error).toBe("access_denied");
  });
});

describe("token endpoint", () => {
  it("sends a form-encoded authorization_code grant without a client secret", async () => {
    let sent: { url: string; body: string; type: string | null } | null = null;
    const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
      sent = { url: String(url), body: String(init?.body), type: new Headers(init?.headers).get("content-type") };
      return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", id_token: "it", token_type: "Bearer", expires_in: 3600, scope: "openid" }), { status: 200 });
    }) as typeof fetch;
    const t = await exchangeCode({ clientId: "oaiapp_1", code: "c", verifier: "v", redirectUri: "http://127.0.0.1:1/auth/callback" }, fake);
    expect(t.access_token).toBe("at");
    expect(sent!.url).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(sent!.type).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(sent!.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "authorization_code",
      client_id: "oaiapp_1",
      code: "c",
      code_verifier: "v",
      redirect_uri: "http://127.0.0.1:1/auth/callback",
      resource: "https://api.openai.com/v1",
    });
    expect(form.has("client_secret")).toBe(false);
  });

  it("raises the OAuth error code on refresh failure", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: "refresh_token_reused" }), { status: 400 })) as unknown as typeof fetch;
    const err = await refreshTokens({ clientId: "oaiapp_1", refreshToken: "r" }, fake).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe("refresh_token_reused");
  });
});

describe("ID token validation", () => {
  async function setup() {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string } = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(opts.iss ?? AUTH_ISSUER)
        .setAudience(opts.aud ?? "oaiapp_1")
        .setSubject("user-sub")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
    return { jwks: { keys: [jwk] }, sign };
  }

  it("accepts a token with the right issuer, audience and nonce", async () => {
    const { jwks, sign } = await setup();
    const t = await sign({ nonce: "n1", email: "a@example.com" });
    expect(await validateIdToken(t, { clientId: "oaiapp_1", nonce: "n1" }, jwks)).toEqual({ sub: "user-sub", email: "a@example.com" });
  });

  it("rejects a wrong nonce, audience or issuer", async () => {
    const { jwks, sign } = await setup();
    await expect(validateIdToken(await sign({ nonce: "other" }), { clientId: "oaiapp_1", nonce: "n1" }, jwks)).rejects.toThrow();
    await expect(validateIdToken(await sign({ nonce: "n1" }, { aud: "oaiapp_2" }), { clientId: "oaiapp_1", nonce: "n1" }, jwks)).rejects.toThrow();
    await expect(validateIdToken(await sign({ nonce: "n1" }, { iss: "https://evil.example" }), { clientId: "oaiapp_1", nonce: "n1" }, jwks)).rejects.toThrow();
  });

  it("rejects a token signed by another key", async () => {
    const { jwks } = await setup();
    const other = await setup();
    const t = await other.sign({ nonce: "n1" });
    await expect(validateIdToken(t, { clientId: "oaiapp_1", nonce: "n1" }, jwks)).rejects.toThrow();
  });
});

describe("plan models", () => {
  it("keeps only listed models", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ models: [{ slug: "a", display_name: "A", visibility: "list" }, { slug: "b", visibility: "hide" }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await listPlanModels("t", fake)).toEqual([{ slug: "a", displayName: "A" }]);
  });
});
