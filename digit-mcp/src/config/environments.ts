import type { Environment } from '../types/index.js';
import { ENDPOINTS } from './endpoints.js';

export const ENVIRONMENTS: Record<string, Environment> = {
  // The only environment entry. Everything is driven by env vars at
  // container start, so the same image works for any tenant on any
  // server:
  //   CRS_API_URL       — DIGIT API base (`http://kong:8000` in compose).
  //   CRS_ENV_NAME      — display name shown by /v1/version + get_environment_info.
  //   CRS_STATE_TENANT  — root tenant used as default for MDMS / tenants queries.
  // Operators can still pass `base_url` to the `configure` tool to point
  // at a different DIGIT at runtime (used by Claude Code clients talking
  // to multiple environments).
  'self-hosted': {
    name: process.env.CRS_ENV_NAME || 'Self-hosted DIGIT',
    url: process.env.CRS_API_URL || 'http://kong:8000',
    stateTenantId: process.env.CRS_STATE_TENANT || 'pg',
    description: 'Self-hosted DIGIT (MCP runs in the same compose stack as the platform)',
    endpointOverrides: {
      MDMS_SEARCH: '/mdms-v2/v2/_search',
      MDMS_CREATE: '/mdms-v2/v2/_create',
      MDMS_UPDATE: '/mdms-v2/v2/_update',
    },
  },
};

const VALID_ENDPOINT_KEYS = new Set(Object.keys(ENDPOINTS));

export function getEnvironment(envKey?: string): Environment {
  const key = envKey || process.env.CRS_ENVIRONMENT || 'self-hosted';
  const env = ENVIRONMENTS[key];
  if (!env) {
    throw new Error(
      `Unknown environment: ${key}. Available: ${Object.keys(ENVIRONMENTS).join(', ')}`
    );
  }

  // Validate endpoint override keys at load time to catch typos early
  if (env.endpointOverrides) {
    for (const overrideKey of Object.keys(env.endpointOverrides)) {
      if (!VALID_ENDPOINT_KEYS.has(overrideKey)) {
        throw new Error(
          `Invalid endpoint override key "${overrideKey}" in environment "${key}". ` +
          `Valid keys: ${[...VALID_ENDPOINT_KEYS].join(', ')}`
        );
      }
    }
  }

  return env;
}
