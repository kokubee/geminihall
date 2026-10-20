export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ACCESS_ADMIN_EMAILS?: string;
  CONSENT_VERSION: string;
  SUBMIT_LIMITER?: RateLimit;
  SUBMIT_TOKEN_LIMITER?: RateLimit;
}

export type AppEnv = { Bindings: Env; Variables: { reviewerId: string } };
