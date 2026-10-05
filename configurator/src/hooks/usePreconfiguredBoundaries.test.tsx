import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sets from '@/utils/__fixtures__/officialSets.json';

const resolveTenantCountry = vi.fn();
vi.mock('@/utils/tenantCountry', () => ({ resolveTenantCountry }));

const { usePreconfiguredBoundaries } = await import('./usePreconfiguredBoundaries');

/** A turbopass that holds `official` (country → set); anything else 404s. */
function turbopass(official: Record<string, unknown> | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok', official }), { status: 200 });
      }
      const country = new URL(url, 'http://x').searchParams.get('country') ?? '';
      const set = official?.[country] ? (sets as Record<string, unknown>)[country] : undefined;
      return set ? new Response(JSON.stringify(set), { status: 200 }) : new Response('{}', { status: 404 });
    }),
  );
}

describe('usePreconfiguredBoundaries', () => {
  beforeEach(() => resolveTenantCountry.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('is unavailable when turbopass holds no official sets', async () => {
    turbopass(null);
    const { result } = renderHook(() => usePreconfiguredBoundaries('ke', '/tp'));
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
    expect(resolveTenantCountry).not.toHaveBeenCalled();
  });

  it("offers the tenant's country set", async () => {
    turbopass({ KE: {}, LR: {} });
    resolveTenantCountry.mockResolvedValue({ country: 'KE', from: 'tenant' });
    const { result } = renderHook(() => usePreconfiguredBoundaries('ke', '/tp'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const state = result.current.state as Extract<typeof result.current.state, { status: 'ready' }>;
    expect(state.set.country).toBe('KE');
    expect(state.countries).toEqual(['KE', 'LR']);
  });

  it('asks for the country when it is unknown, and loads the one picked', async () => {
    turbopass({ KE: {}, LR: {} });
    resolveTenantCountry.mockResolvedValue(null);
    const { result } = renderHook(() => usePreconfiguredBoundaries('acme', '/tp'));
    await waitFor(() => expect(result.current.state.status).toBe('pick-country'));
    act(() => result.current.chooseCountry('LR'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect((result.current.state as { set: { country: string } }).set.country).toBe('LR');
  });

  it('says when the country has no set here', async () => {
    turbopass({ KE: {} });
    resolveTenantCountry.mockResolvedValue({ country: 'TZ', from: 'dial-code' });
    const { result } = renderHook(() => usePreconfiguredBoundaries('tz', '/tp'));
    await waitFor(() => expect(result.current.state.status).toBe('none'));
  });
});
