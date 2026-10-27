import { resolveTenantRoute } from "../packages/libraries/src/services/tenant/tenantRoute";

/**
 * Tenant for the public dashboard page.
 *
 * The page is served at /<slug>/digit-ui/public-dashboard. The slug names the
 * workspace whose public dashboard this is, so it is resolved through the
 * Identity BFF exactly as the employee/citizen SPA does (src/index.js) and the
 * result is installed as window.__digitTenantContext, which getTenantId() and
 * every other dashboard read prefer.
 *
 * Without this, getTenantId() fell through to the deployment's
 * STATE_LEVEL_TENANT_ID, so every workspace's public URL showed the deployment
 * root's dashboard (the root plus its whole subtree) instead of its own.
 *
 * A tenant route that cannot be resolved (unknown slug, BFF outage with no
 * cached context, a mapping that fails verification) is NOT allowed to fall
 * back to STATE_LEVEL_TENANT_ID: the caller must show the page as unavailable.
 * Only a tenantless path (the dev server; nginx 302s or 404s it in a
 * deployment) keeps the configured state tenant.
 *
 * @returns {Promise<{ tenant: object|null, unavailable: boolean }>}
 */
export async function resolvePublicDashboardTenant(pathname, fetchImpl, storage) {
  try {
    const tenant = await resolveTenantRoute(pathname, fetchImpl, storage);
    if (tenant && typeof window !== "undefined") window.__digitTenantContext = tenant;
    return { tenant: tenant || null, unavailable: false };
  } catch (error) {
    if (typeof window !== "undefined") {
      delete window.__digitTenantContext;
      window.__digitTenantContextError = error;
    }
    return { tenant: null, unavailable: true };
  }
}
