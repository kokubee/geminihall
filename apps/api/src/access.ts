import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

export type AdminVerifier = (request: Request, env: Env) => Promise<string | null>;

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const verifyAccessJwt: AdminVerifier = async (request, env) => {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (!team || !aud) return null;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  const issuer = `https://${team}`;
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: aud });
    const email = typeof payload.email === "string" ? payload.email : null;
    return email ?? (typeof payload.sub === "string" ? payload.sub : null);
  } catch {
    return null;
  }
};
