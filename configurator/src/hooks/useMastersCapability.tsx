import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAuthProvider, getResourceConfig, onAuthChange, digitClient } from '@/providers/bridge';
import type { DigitPermissions } from '@digit-mcp/data-provider';

/**
 * Masters visibility/edit capability for the logged-in user, computed
 * client-side from existing accesscontrol MDMS data (no server-side
 * enforcement for masters — see
 * docs/design/masters-configurator-access-policy-design.md §3.3). Fetched
 * via authProvider.getPermissions() and shared through context so nav,
 * resource routing, and edit/create screens all read the same capability
 * without re-fetching.
 *
 * Re-fetches on every `onAuthChange` notification (bridge.ts — fired from
 * `configureDigitClient`, i.e. every login), not just once per component
 * mount. `ManagementAdmin` staying mounted across a logout/login cycle in
 * the same tab (or any other reason the mount-once effect might not re-run)
 * previously left a PREVIOUS user's capability (e.g. an MDMS_ADMIN's "see
 * everything") in place for whoever logged in next, silently over-granting
 * masters visibility to a more-restricted role.
 */
const OPEN_PERMISSIONS: DigitPermissions = {
  roles: [],
  masters: { canView: () => true, canEdit: () => false },
};

// Distinct from OPEN_PERMISSIONS: used ONLY when the policy fetch itself
// failed, never as the transient loading placeholder. A fetch failure means
// we genuinely don't know the policy — defaulting to "show everything" would
// silently reveal masters a restricted role shouldn't see, which is worse
// than a temporarily-empty admin console the user can retry.
const ERROR_PERMISSIONS: DigitPermissions = {
  roles: [],
  masters: { canView: () => false, canEdit: () => false },
};

const MastersCapabilityContext = createContext<DigitPermissions>(OPEN_PERMISSIONS);

function identityKeyOf(): string {
  const info = digitClient.getAuthInfo();
  return `${info.user?.uuid ?? ''}|${info.user?.tenantId ?? ''}`;
}

export function MastersCapabilityProvider({ children }: { children: ReactNode }) {
  const [identityKey, setIdentityKey] = useState(identityKeyOf);
  const [permissions, setPermissions] = useState<DigitPermissions>(OPEN_PERMISSIONS);

  // Subscribe once for the component's lifetime; every login re-fires this
  // regardless of whether identityKey actually changed (e.g. the same user
  // logging back in), which is fine — the fetch below is idempotent.
  useEffect(() => onAuthChange(() => setIdentityKey(identityKeyOf())), []);

  useEffect(() => {
    let cancelled = false;
    // Reset to the fail-open default immediately on identity change, rather
    // than leaving the PREVIOUS user's (possibly more permissive) capability
    // visible for the duration of the new fetch.
    setPermissions(OPEN_PERMISSIONS);
    const authProvider = getAuthProvider();
    if (!authProvider.getPermissions) return;
    authProvider
      .getPermissions(undefined)
      .then((perms: DigitPermissions) => {
        if (!cancelled) setPermissions(perms);
      })
      .catch((err) => {
        // Fail CLOSED on an actual fetch failure — a failed fetch means we
        // don't know the policy, not that none is configured; see
        // ERROR_PERMISSIONS above for why this must not reuse
        // OPEN_PERMISSIONS's "show everything" default.
        console.error('useMastersCapability: failed to load access policy', err);
        if (!cancelled) setPermissions(ERROR_PERMISSIONS);
      });
    return () => {
      cancelled = true;
    };
  }, [identityKey]);

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
