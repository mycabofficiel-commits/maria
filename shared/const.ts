export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// ─── Plan limits (single source of truth — used by server + client) ──────────
export const PLAN_LIMITS = {
  free:    { projectsLimit: 1,    dailyGenerations: 3,  maxTokensPerGen: 8_000  },
  creator: { projectsLimit: 5,    dailyGenerations: 20, maxTokensPerGen: 16_000 },
  pro:     { projectsLimit: 20,   dailyGenerations: 50, maxTokensPerGen: 24_000 },
  agency:  { projectsLimit: 9999, dailyGenerations: -1, maxTokensPerGen: 32_000 },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;
