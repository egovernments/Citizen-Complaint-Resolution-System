import { useEffect, useState } from 'react';
import { session } from '@/api/onboarding';

// digit-ui's own route rule (tenantRoute.js): the slug is a path segment.
const URL_SLUG = /^[a-z0-9-]{2,63}$/;

/**
 * Where a tenant page loads the analytics shim from. Bundle assets are also
 * served on the tenantless /digit-ui/ prefix, so that is the fallback when
 * the slug is unknown.
 */
export function analyticsShimPath(slug: string | null): string {
  return slug ? `/${slug}/digit-ui/analytics.js` : '/digit-ui/analytics.js';
}

/**
 * The public route slug of the workspace this session has selected, for links
 * into the tenant-scoped digit-ui (`/<slug>/digit-ui/...`). The slug is the
 * workspace's Keycloak Organization alias (identity-bff.md §2.4), which the
 * BFF reports as `context.organizationAlias` on the configurator session.
 *
 * `undefined` while the session is being read; `null` when it has no selected
 * context for `tenantId` (a stale tab, a local DIGIT login, a BFF outage).
 */
export function useWorkspaceSlug(tenantId: string): string | null | undefined {
  const [slug, setSlug] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    setSlug(undefined);
    session(controller.signal)
      .then((current) => {
        const context = current.context as { tenantId?: unknown; organizationAlias?: unknown } | null | undefined;
        const alias = typeof context?.organizationAlias === 'string' ? context.organizationAlias.toLowerCase() : '';
        setSlug(context?.tenantId === tenantId && URL_SLUG.test(alias) ? alias : null);
      })
      .catch(() => { if (!controller.signal.aborted) setSlug(null); });
    return () => controller.abort();
  }, [tenantId]);
  return slug;
}
