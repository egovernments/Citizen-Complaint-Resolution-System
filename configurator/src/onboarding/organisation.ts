import { useEffect, useState } from 'react';
import { mdmsService } from '@/api';

export interface Organisation {
  name: string;
  logoUrl: string | null;
}

const UPDATED = 'ccrs:organisation-updated';

export function initialsOf(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/** Tell whatever shows the organisation (the rail) that Branding just saved it. */
export function announceOrganisation(organisation: Organisation): void {
  window.dispatchEvent(new CustomEvent<Organisation>(UPDATED, { detail: organisation }));
}

/**
 * The workspace's display name and logo from its tenant record, with the code
 * standing in until the record loads (or if it cannot).
 */
export function useOrganisation(tenant: string): Organisation {
  const [organisation, setOrganisation] = useState<Organisation | null>(null);

  useEffect(() => {
    let cancelled = false;
    mdmsService
      .getTenants(tenant.split('.')[0])
      .then((tenants) => {
        const match = tenants.find((candidate) => candidate.code === tenant);
        if (!cancelled && match) setOrganisation({ name: match.name || tenant, logoUrl: match.logoId || null });
      })
      .catch(() => {
        // The code stands in for the name; nothing to surface.
      });
    const onUpdated = (event: Event) => setOrganisation((event as CustomEvent<Organisation>).detail);
    window.addEventListener(UPDATED, onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(UPDATED, onUpdated);
    };
  }, [tenant]);

  return organisation ?? { name: tenant, logoUrl: null };
}
