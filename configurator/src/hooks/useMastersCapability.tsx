import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAuthProvider, getResourceConfig } from '@/providers/bridge';
import type { DigitPermissions } from '@digit-mcp/data-provider';

/**
 * Masters visibility/edit capability for the logged-in user, computed
 * client-side from existing accesscontrol MDMS data (no server-side
 * enforcement for masters — see
 * docs/design/masters-configurator-access-policy-design.md §3.3). Fetched
 * once per session via authProvider.getPermissions() and shared through
 * context so nav, resource routing, and edit/create screens all read the
 * same capability without re-fetching.
 */
const OPEN_PERMISSIONS: DigitPermissions = {
  roles: [],
  masters: { canView: () => true, canEdit: () => false },
};

const MastersCapabilityContext = createContext<DigitPermissions>(OPEN_PERMISSIONS);

export function MastersCapabilityProvider({ children }: { children: ReactNode }) {
  const [permissions, setPermissions] = useState<DigitPermissions>(OPEN_PERMISSIONS);

  useEffect(() => {
    let cancelled = false;
    const authProvider = getAuthProvider();
    if (!authProvider.getPermissions) return;
    authProvider
      .getPermissions(undefined)
      .then((perms: DigitPermissions) => {
        if (!cancelled) setPermissions(perms);
      })
      .catch(() => {
        // Fail open (default OPEN_PERMISSIONS stays in effect) — masters
        // gating is UI-only presentation, not a security boundary; a
        // policy-fetch failure must never lock an admin out of the console.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MastersCapabilityContext.Provider value={permissions}>
      {children}
    </MastersCapabilityContext.Provider>
  );
}

export function useMastersCapability() {
  const { roles, masters } = useContext(MastersCapabilityContext);
  return {
    roles,
    canViewResource: (name: string) => masters.canView(getResourceConfig(name)?.schema),
    canEditResource: (name: string) => masters.canEdit(getResourceConfig(name)?.schema),
  };
}
