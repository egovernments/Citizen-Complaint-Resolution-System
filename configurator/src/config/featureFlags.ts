import { isEnabledFlag } from '../../../ui-shared/featureFlags';

export { isEnabledFlag } from '../../../ui-shared/featureFlags';

declare global {
  interface Window {
    __CCRS_BUILD_FLAGS__?: {
      legacyPgrDashboardEnabled: boolean;
      legacyPgrDashboardRaw: string;
    };
  }
}

/**
 * The pre-catalog PGR dashboard is retained only as a rollback aid. It must be
 * explicitly enabled at build time; an absent or malformed value fails closed.
 */
const legacyPgrDashboardRaw = import.meta.env.VITE_ENABLE_LEGACY_PGR_DASHBOARD ?? '';
export const LEGACY_PGR_DASHBOARD_ENABLED = isEnabledFlag(legacyPgrDashboardRaw);

// E2E runs against an already-built image. Publish the baked value so the test
// can verify its expected build contract instead of guessing from a separate
// runtime-only environment variable.
if (typeof window !== 'undefined') {
  window.__CCRS_BUILD_FLAGS__ = {
    legacyPgrDashboardEnabled: LEGACY_PGR_DASHBOARD_ENABLED,
    legacyPgrDashboardRaw,
  };
}
