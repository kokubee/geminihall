import {
  OAuthError,
  TERMINAL_REFRESH_ERRORS,
  buildAuthorizeUrl,
  exchangeCode,
  grantedScopes,
  hasPlanScope,
  listPlanModels,
  loopbackRedirectUri,
  parseCallback,
  pickPort,
  pkceChallenge,
  randomToken,
  refreshTokens,
  revokeRefreshToken,
  validateIdToken,
  type PlanModel,
  type TokenResponse,
} from "./siwc";
import {
  LOCAL_KEYS,
  SESSION_KEYS,
  type SiwcPending,
  type SiwcRegistration,
  type SiwcStatus,
  type SiwcTokens,
} from "./state";

const CALLBACK_RULE_ID = 7301;
const PENDING_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function getLocal<T>(key: string): Promise<T | undefined> {
  return (await chrome.storage.local.get(key))[key] as T | undefined;
}

async function getSession<T>(key: string): Promise<T | undefined> {
  return (await chrome.storage.session.get(key))[key] as T | undefined;
}

export async function setStatus(status: SiwcStatus) {
  await chrome.storage.session.set({ [SESSION_KEYS.siwcStatus]: status });
}

export async function hostId(): Promise<string> {
  const existing = await getLocal<string>(LOCAL_KEYS.siwcHostId);
  if (existing) return existing;
  const id = `urn:uuid:${crypto.randomUUID()}`;
  await chrome.storage.local.set({ [LOCAL_KEYS.siwcHostId]: id });
  return id;
}

export function registration() {
  return getLocal<SiwcRegistration>(LOCAL_KEYS.siwcRegistration);
}

async function clearCallbackRule() {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [CALLBACK_RULE_ID] });
}

export async function startSignIn(): Promise<void> {
  const reg = await registration();
  const port = pickPort();
  const pending: SiwcPending = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(48),
    redirectUri: loopbackRedirectUri(port),
    clientId: reg?.clientId ?? null,
    startedAt: Date.now(),
  };
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [CALLBACK_RULE_ID],
    addRules: [
      {
        id: CALLBACK_RULE_ID,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
          redirect: { regexSubstitution: `${chrome.runtime.getURL("siwc-callback.html")}?\\1` },
        },
        condition: {
          regexFilter: `^http://127\\.0\\.0\\.1:${port}/auth/callback\\?(.*)$`,
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
        },
      },
    ],
  });
  await chrome.storage.session.set({ [SESSION_KEYS.siwcPending]: pending });
  await setStatus({ state: "SIGNING_IN" });
  const url = buildAuthorizeUrl({
    clientId: pending.clientId,
    hostId: await hostId(),
    redirectUri: pending.redirectUri,
    state: pending.state,
    nonce: pending.nonce,
    codeChallenge: await pkceChallenge(pending.verifier),
    loginHint: reg?.email ?? undefined,
  });
  await chrome.tabs.create({ url });
}

function tokensFrom(res: TokenResponse, clientId: string, sub: string, previousRefresh: string | null): SiwcTokens {
  return {
    clientId,
    sub,
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + res.expires_in * 1000,
    scopes: [...grantedScopes(res.scope)],
  };
}

export type CallbackOutcome = { ok: true; planEnabled: boolean } | { ok: false; message: string };

export async function completeSignIn(search: string): Promise<CallbackOutcome> {
  const pending = await getSession<SiwcPending>(SESSION_KEYS.siwcPending);
  await chrome.storage.session.remove(SESSION_KEYS.siwcPending);
  await clearCallbackRule();
  const fail = async (message: string): Promise<CallbackOutcome> => {
    await setStatus({ state: "ERROR", message });
    return { ok: false, message };
  };

  const cb = parseCallback(search);
  if (!pending || Date.now() - pending.startedAt > PENDING_TTL_MS) return fail("ログインの受付期限が切れました。もう一度ログインしてください。");
  if (cb.state !== pending.state) return fail("ログインの応答を確認できませんでした（state の不一致）。もう一度ログインしてください。");
  if (cb.error === "access_denied") {
    await setStatus({ state: "SIGNED_OUT", message: "ログインが取り消されました。" });
    return { ok: false, message: "ログインが取り消されました。" };
  }
  if (cb.error || !cb.code) return fail("ログインに失敗しました。もう一度試してください。");

  let clientId = pending.clientId;
  if (!clientId) {
    if (!cb.clientId || !cb.clientId.startsWith("oaiapp_")) return fail("アプリの登録が完了しませんでした。もう一度ログインしてください。");
    clientId = cb.clientId;
  } else if (cb.clientId && cb.clientId !== clientId) {
    return fail("想定と異なるアプリ登録の応答が返りました。ログインを中止しました。");
  }

  let res: TokenResponse;
  try {
    res = await exchangeCode({ clientId, code: cb.code, verifier: pending.verifier, redirectUri: pending.redirectUri });
  } catch {
    return fail("ログインの確認（トークンの取得）に失敗しました。もう一度ログインしてください。");
  }
  if (!res.id_token) return fail("ログインの確認に必要な情報が返りませんでした。");

  let identity: { sub: string; email: string | null };
  try {
    identity = await validateIdToken(res.id_token, { clientId, nonce: pending.nonce });
  } catch {
    return fail("ログインの確認（ID トークンの検証）に失敗しました。");
  }

  const prev = await registration();
  if (prev && prev.clientId === clientId && prev.sub !== identity.sub) {
    return fail("選んだアカウントと異なるアカウントでログインされました。ログインを中止しました。");
  }
  await chrome.storage.local.set({
    [LOCAL_KEYS.siwcRegistration]: {
      clientId,
      sub: identity.sub,
      email: identity.email,
      welcomed: prev?.clientId === clientId ? prev.welcomed : false,
    } satisfies SiwcRegistration,
  });
  await chrome.storage.session.set({ [SESSION_KEYS.siwcTokens]: tokensFrom(res, clientId, identity.sub, null) });

  const planEnabled = hasPlanScope(res.scope);
  await setStatus(planEnabled ? { state: "SIGNED_IN", email: identity.email } : { state: "NO_PLAN", email: identity.email });
  return { ok: true, planEnabled };
}

let refreshing: Promise<SiwcTokens | null> | null = null;

export async function accessToken(): Promise<string | null> {
  const tokens = await getSession<SiwcTokens>(SESSION_KEYS.siwcTokens);
  if (!tokens || !tokens.scopes.includes("chatgpt.tokens.use.direct")) return null;
  if (tokens.expiresAt - REFRESH_MARGIN_MS > Date.now()) return tokens.accessToken;
  if (!tokens.refreshToken) return null;
  refreshing ??= (async () => {
    try {
      const res = await refreshTokens({ clientId: tokens.clientId, refreshToken: tokens.refreshToken! });
      const next = tokensFrom(res, tokens.clientId, tokens.sub, tokens.refreshToken);
      await chrome.storage.session.set({ [SESSION_KEYS.siwcTokens]: next });
      return next;
    } catch (err) {
      if (err instanceof OAuthError && (TERMINAL_REFRESH_ERRORS.has(err.code) || err.code === "invalid_client")) {
        await chrome.storage.session.remove(SESSION_KEYS.siwcTokens);
        await setStatus({ state: "SIGNED_OUT", message: "ChatGPT のログインの有効期限が切れたか、連携が解除されました。もう一度ログインしてください。" });
      }
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return (await refreshing)?.accessToken ?? null;
}

export async function invalidateSession(message: string) {
  await chrome.storage.session.remove(SESSION_KEYS.siwcTokens);
  await setStatus({ state: "SIGNED_OUT", message });
}

export async function signOut(): Promise<{ revoked: boolean }> {
  const tokens = await getSession<SiwcTokens>(SESSION_KEYS.siwcTokens);
  let revoked = false;
  if (tokens?.refreshToken) {
    for (let attempt = 0; attempt < 3 && !revoked; attempt++) {
      revoked = await revokeRefreshToken({ clientId: tokens.clientId, refreshToken: tokens.refreshToken }).catch(() => false);
      if (!revoked) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  await chrome.storage.session.remove(SESSION_KEYS.siwcTokens);
  await setStatus({
    state: "SIGNED_OUT",
    message: revoked || !tokens?.refreshToken ? "ログアウトしました。" : "ログアウトしましたが、ChatGPT 側での連携解除を確認できませんでした。必要に応じて ChatGPT の設定から GeminiHall の連携を解除してください。",
  });
  return { revoked };
}

export async function planModels(): Promise<PlanModel[]> {
  const token = await accessToken();
  if (!token) return [];
  return listPlanModels(token).catch(() => []);
}

export async function acknowledgeWelcome() {
  const reg = await registration();
  if (reg) await chrome.storage.local.set({ [LOCAL_KEYS.siwcRegistration]: { ...reg, welcomed: true } });
}
