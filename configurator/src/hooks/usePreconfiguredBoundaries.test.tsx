import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sets from '@/utils/__fixtures__/officialSets.json';

const resolveTenantCountry = vi.fn();
vi.mock('@/utils/tenantCountry', () => ({ resolveTenantCountry }));

const { usePreconfiguredBoundaries } = await import('./usePreconfiguredBoundaries');

/** /boundary/official answering with the fixture, or with `status` for every call. */
function officialEndpoint(status = 200) {
  const fetchMock = vi.fn(async (url: string) => {
    const country = new URL(url, 'http://x').searchParams.get('country') ?? '';
    return status === 200
      ? new Response(JSON.stringify((sets as Record<string, unknown>)[country]), { status: 200 })
      : new Response('{}', { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('usePreconfiguredBoundaries', () => {
  beforeEach(() => resolveTenantCountry.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('waits for Geography\'s /health read, and makes no /health call of its own', async () => {
    const fetchMock = officialEndpoint();
    const { result, rerender } = renderHook(({ c }) => usePreconfiguredBoundaries('ke', c, '/tp'), {
      initialProps: { c: null as string[] | null },
    });
    expect(result.current.state.status).toBe('loading');
    expect(resolveTenantCountry).not.toHaveBeenCalled();
    resolveTenantCountry.mockResolvedValue('KE');
    rerender({ c: ['KE', 'LR'] });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(['/tp/boundary/official?country=KE']);
  });

  it('is unavailable when turbopass holds no official sets', async () => {
    const { result } = renderHook(() => usePreconfiguredBoundaries('ke', [], '/tp'));
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
  });

  it('says so when the tenant has no country on record', async () => {
    resolveTenantCountry.mockResolvedValue(null);
    const { result } = renderHook(() => usePreconfiguredBoundaries('acme', ['KE'], '/tp'));
    await waitFor(() => expect(result.current.state.status).toBe('unknown-country'));
  });

  it('answers "none" for a country /health does not list, without asking for it', async () => {
    const fetchMock = officialEndpoint();
    resolveTenantCountry.mockResolvedValue('TZ');
    const { result } = renderHook(() => usePreconfiguredBoundaries('tz', ['KE'], '/tp'));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'none', country: 'TZ' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a failure for a listed country as an error to retry, not as "no set"', async () => {
    // 404 for a listed country: a turbopass that predates /boundary/official.
    officialEndpoint(404);
    resolveTenantCountry.mockResolvedValue('KE');
    const { result } = renderHook(() => usePreconfiguredBoundaries('ke', ['KE'], '/tp'));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'error', country: 'KE' }));
    officialEndpoint(200);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
  });
});
