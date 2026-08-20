import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MastersCapabilityProvider, useMastersCapability } from './useMastersCapability';

const getPermissions = vi.fn();
let authChangeListener: (() => void) | null = null;
let authInfo: { user: { uuid: string; tenantId: string } } = { user: { uuid: 'u1', tenantId: 't1' } };

vi.mock('@/providers/bridge', () => ({
  getAuthProvider: () => ({ getPermissions }),
  onAuthChange: (listener: () => void) => {
    authChangeListener = listener;
    return () => {};
  },
  getResourceConfig: (name: string) => ({ schema: name }),
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
