import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAuthProvider, getResourceConfig, isAccessControlGated, onAuthChange, digitClient } from '@/providers/bridge';
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
 *
 * There is no "fail open" window anywhere in this component's lifecycle:
 * before the first fetch resolves, during a refetch after an identity
 * change, and on an outright fetch failure all resolve to the SAME
 * deny-by-default capability below — a caller can read canView/canEdit at
 * any point and get a safe answer, never a transient "view everything"
 * while the real (possibly restrictive) policy is still loading.
 */
const DENIED_PERMISSIONS: DigitPermissions = {
  roles: [],
  masters: { canView: () => false, canEdit: () => false },
};

const MastersCapabilityContext = createContext<DigitPermissions>(DENIED_PERMISSIONS);

function identityKeyOf(): string {
  const info = digitClient.getAuthInfo();
  return `${info.user?.uuid ?? ''}|${info.user?.tenantId ?? ''}`;
}

export function MastersCapabilityProvider({ children }: { children: ReactNode }) {
  const [identityKey, setIdentityKey] = useState(identityKeyOf);
  const [permissions, setPermissions] = useState<DigitPermissions>(DENIED_PERMISSIONS);

  // Subscribe once for the component's lifetime; every login re-fires this
  // regardless of whether identityKey actually changed (e.g. the same user
  // logging back in), which is fine — the fetch below is idempotent.
  useEffect(() => onAuthChange(() => setIdentityKey(identityKeyOf())), []);

  useEffect(() => {
    let cancelled = false;
    // Reset to deny-by-default immediately on identity change — never leave
    // the PREVIOUS user's (possibly more permissive) capability visible for
    // the duration of the new fetch, and never fall back to "show
    // everything" while the new one is in flight either.
    setPermissions(DENIED_PERMISSIONS);
    const authProvider = getAuthProvider();
    if (!authProvider.getPermissions) return;
    authProvider
      .getPermissions(undefined)
      .then((perms: DigitPermissions) => {
        if (!cancelled) setPermissions(perms);
      })
      .catch((err) => {
        // A failed fetch means we don't know the policy, not that none is
        // configured — stays on the same deny-by-default default rather than
        // resolving to "show everything".
        console.error('useMastersCapability: failed to load access policy', err);
        if (!cancelled) setPermissions(DENIED_PERMISSIONS);
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
    // The view/edit/create policy check (ACCESSCONTROL-ACTIONS-TEST/ROLEACTIONS)
    // only applies to resources `isAccessControlGated` (resourceRegistry.ts) marks
    // as gated: every genuine mdms-v2-backed master (`type: 'mdms'`), plus the
    // small explicit allowlist of non-'mdms'-typed resources that still have a
    // real `/mdms-v2/v2/_create|_update/<schema>` action in the seed (currently
    // access-roles/access-actions — the screens that edit the permission system
    // itself). Gating on `type === 'mdms'` alone silently left those two
    // unrestricted for every role (#1826 review). Every other resource type
    // (hrms, boundary, pgr, localization, user, workflow-*, mdms-schema, custom,
    // ...) stays unrestricted — same as before this whole masters-gating feature
    // existed. Do not extend the allowlist without an explicit decision to gate
    // that specific resource; see docs/design/masters-configurator-access-policy-design.md.
    canViewResource: (name: string) => {
      const config = getResourceConfig(name);
      if (!isAccessControlGated(config)) return true;
      return masters.canView(config!.schema);
    },
    canEditResource: (name: string) => {
      const config = getResourceConfig(name);
      if (!isAccessControlGated(config)) return true;
      return masters.canEdit(config!.schema);
    },
  };
}
