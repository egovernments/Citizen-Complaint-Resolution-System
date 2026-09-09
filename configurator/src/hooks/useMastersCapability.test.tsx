import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MastersCapabilityProvider, useMastersCapability } from './useMastersCapability';

const getPermissions = vi.fn();
let authChangeListener: (() => void) | null = null;
let authInfo: { user: { uuid: string; tenantId: string } } = { user: { uuid: 'u1', tenantId: 't1' } };

// Per-resource-name overrides for the tests below that need a specific ResourceConfig shape
// (a non-mdms `type`) — defaults to a plain mdms-typed config every other test relies on, since
// the policy check only ever applies to `type: 'mdms'` resources (see useMastersCapability.tsx).
let resourceConfigOverrides: Record<string, unknown> = {};

// Mirrors resourceRegistry.ts's real allowlist: `type: 'mdms'` plus the two
// non-'mdms'-typed exceptions that still carry a real mdms-v2 write action.
const EXPLICITLY_GATED_TYPES = new Set(['access-role', 'access-action']);
function isAccessControlGated(config: { type?: string } | undefined): boolean {
  if (!config) return false;
  return config.type === 'mdms' || EXPLICITLY_GATED_TYPES.has(config.type as string);
}

vi.mock('@/providers/bridge', () => ({
  getAuthProvider: () => ({ getPermissions }),
  onAuthChange: (listener: () => void) => {
    authChangeListener = listener;
    return () => {};
  },
  getResourceConfig: (name: string) => resourceConfigOverrides[name] ?? { type: 'mdms', schema: name },
  isAccessControlGated: (config: { type?: string } | undefined) => isAccessControlGated(config),
  digitClient: { getAuthInfo: () => authInfo },
}));

function renderCapability() {
  return renderHook(() => useMastersCapability(), {
    wrapper: ({ children }) => <MastersCapabilityProvider>{children}</MastersCapabilityProvider>,
  });
}

const OPEN = { roles: ['MDMS_ADMIN'], masters: { canView: () => true, canEdit: () => true } };

beforeEach(() => {
  getPermissions.mockReset();
  authChangeListener = null;
  authInfo = { user: { uuid: 'u1', tenantId: 't1' } };
  resourceConfigOverrides = {};
});

describe('MastersCapabilityProvider — deny-by-default lifecycle (#1441 review)', () => {
  it('denies before the first fetch resolves, not "view everything"', async () => {
    let resolveFetch!: (v: typeof OPEN) => void;
    getPermissions.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const { result } = renderCapability();

    expect(result.current.canViewResource('anything')).toBe(false);
    expect(result.current.canEditResource('anything')).toBe(false);

    await act(async () => resolveFetch(OPEN));
    await waitFor(() => expect(result.current.canViewResource('anything')).toBe(true));
  });

  it('denies again immediately on identity change — before the new fetch resolves, not the old (open) capability', async () => {
    getPermissions.mockResolvedValueOnce(OPEN);
    const { result } = renderCapability();
    await waitFor(() => expect(result.current.canViewResource('anything')).toBe(true));

    let resolveSecond!: (v: typeof OPEN) => void;
    getPermissions.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    authInfo = { user: { uuid: 'u2', tenantId: 't2' } };
    act(() => authChangeListener?.());

    // Must be denied NOW, mid-flight — never a window where the previous
    // user's (or a default-open) capability is still visible.
    expect(result.current.canViewResource('anything')).toBe(false);

    await act(async () => resolveSecond({ roles: ['GRO'], masters: { canView: () => false, canEdit: () => false } }));
    expect(getPermissions).toHaveBeenCalledTimes(2);
    expect(result.current.canViewResource('anything')).toBe(false);
  });

  it('denies on a fetch failure rather than resolving as an open policy', async () => {
    getPermissions.mockRejectedValue(new Error('network down'));
    const { result } = renderCapability();

    await waitFor(() => expect(getPermissions).toHaveBeenCalled());
    await waitFor(() => expect(result.current.canViewResource('anything')).toBe(false));
    expect(result.current.canEditResource('anything')).toBe(false);
  });
});

describe('canViewResource/canEditResource — the ACCESSCONTROL policy check only applies to type: \'mdms\' resources', () => {
  it('consults masters.canView/canEdit for a type: \'mdms\' resource', async () => {
    resourceConfigOverrides.departments = { type: 'mdms', schema: 'common-masters.Department' };
    const canView = vi.fn(() => false);
    const canEdit = vi.fn(() => false);
    getPermissions.mockResolvedValue({ roles: ['SUPERVISOR'], masters: { canView, canEdit } });

    const { result } = renderCapability();
    await waitFor(() => expect(result.current.roles).toEqual(['SUPERVISOR']));

    expect(result.current.canViewResource('departments')).toBe(false);
    expect(canView).toHaveBeenCalledWith('common-masters.Department');
    expect(result.current.canEditResource('departments')).toBe(false);
    expect(canEdit).toHaveBeenCalledWith('common-masters.Department');
  });

  it('is unrestricted (true) for any non-mdms resource, regardless of the fetched policy — e.g. Employees (hrms), Complaints (pgr), Localization', async () => {
    resourceConfigOverrides.employees = { type: 'hrms', endpoint: { search: '/egov-hrms/employees/_search', create: '/egov-hrms/employees/_create', update: '/egov-hrms/employees/_update' } };
    resourceConfigOverrides.complaints = { type: 'pgr' };
    resourceConfigOverrides.localization = { type: 'localization', endpoint: { search: '/localization/messages/v1/_search', create: '/localization/messages/v1/_upsert' } };
    // A restrictive policy that would deny everything if it were ever consulted for these —
    // proves the type check short-circuits before masters.canView/canEdit is even called.
    const canView = vi.fn(() => false);
    const canEdit = vi.fn(() => false);
    getPermissions.mockResolvedValue({ roles: ['GRO'], masters: { canView, canEdit } });

    const { result } = renderCapability();
    await waitFor(() => expect(result.current.roles).toEqual(['GRO']));

    for (const name of ['employees', 'complaints', 'localization']) {
      expect(result.current.canViewResource(name)).toBe(true);
      expect(result.current.canEditResource(name)).toBe(true);
    }
    expect(canView).not.toHaveBeenCalled();
    expect(canEdit).not.toHaveBeenCalled();
  });

  it('still consults masters.canView/canEdit for access-roles/access-actions despite their non-mdms type (#1826 review — type===\'mdms\' alone silently ungated these)', async () => {
    resourceConfigOverrides['access-roles'] = { type: 'access-role', schema: 'ACCESSCONTROL-ROLES.roles' };
    resourceConfigOverrides['access-actions'] = { type: 'access-action', schema: 'ACCESSCONTROL-ACTIONS-TEST.actions-test' };
    const canView = vi.fn(() => false);
    const canEdit = vi.fn(() => false);
    getPermissions.mockResolvedValue({ roles: ['GRO'], masters: { canView, canEdit } });

    const { result } = renderCapability();
    await waitFor(() => expect(result.current.roles).toEqual(['GRO']));

    expect(result.current.canViewResource('access-roles')).toBe(false);
    expect(canView).toHaveBeenCalledWith('ACCESSCONTROL-ROLES.roles');
    expect(result.current.canEditResource('access-actions')).toBe(false);
    expect(canEdit).toHaveBeenCalledWith('ACCESSCONTROL-ACTIONS-TEST.actions-test');
  });
});
