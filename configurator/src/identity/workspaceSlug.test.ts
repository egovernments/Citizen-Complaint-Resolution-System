import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { session } from '@/api/onboarding';
import { analyticsShimPath, useWorkspaceSlug } from './workspaceSlug';

vi.mock('@/api/onboarding', () => ({ session: vi.fn() }));
beforeEach(() => { vi.mocked(session).mockReset(); });

it('reads the selected workspace slug from the configurator session', async () => {
  vi.mocked(session).mockResolvedValue({ authenticated: true, context: { tenantId: 'acme', organizationAlias: 'acme-council', name: 'Acme' } });
  const { result } = renderHook(() => useWorkspaceSlug('acme'));
  expect(result.current).toBeUndefined();
  await waitFor(() => expect(result.current).toBe('acme-council'));
});

it.each([
  ['another workspace', { authenticated: true, context: { tenantId: 'other', organizationAlias: 'other' } }],
  ['no selected context', { authenticated: true, context: null }],
  ['signed out', { authenticated: false }],
  ['not a route slug', { authenticated: true, context: { tenantId: 'acme', organizationAlias: 'a/b' } }],
])('is null for %s', async (_, value) => {
  vi.mocked(session).mockResolvedValue(value);
  const { result } = renderHook(() => useWorkspaceSlug('acme'));
  await waitFor(() => expect(result.current).toBeNull());
});

it('is null when the identity BFF is unavailable', async () => {
  vi.mocked(session).mockRejectedValue(new Error('down'));
  const { result } = renderHook(() => useWorkspaceSlug('acme'));
  await waitFor(() => expect(result.current).toBeNull());
});

it('probes the analytics shim where a tenant page loads it', () => {
  expect(analyticsShimPath('acme')).toBe('/acme/digit-ui/analytics.js');
  expect(analyticsShimPath(null)).toBe('/digit-ui/analytics.js');
});
