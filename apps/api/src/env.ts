export interface Env {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  CONSENT_VERSION: string;
  SUBMIT_LIMITER?: RateLimit;
}

export type AppEnv = { Bindings: Env; Variables: { reviewerId: string } };
