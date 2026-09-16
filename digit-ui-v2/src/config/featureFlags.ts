import { isEnabledFlag } from '../../../ui-shared/featureFlags';

export { isEnabledFlag } from '../../../ui-shared/featureFlags';

/**
 * The pre-catalog PGR dashboard is retained only as a rollback aid. It must be
 * explicitly enabled at build time; an absent or malformed value fails closed.
 */
export const LEGACY_PGR_DASHBOARD_ENABLED = isEnabledFlag(
  import.meta.env.VITE_ENABLE_LEGACY_PGR_DASHBOARD,
);

export const CITIZEN_HOME_PATH = LEGACY_PGR_DASHBOARD_ENABLED ? '/dashboard' : '/complaints';
