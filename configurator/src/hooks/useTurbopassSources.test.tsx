import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTurbopassHealth } from './useTurbopassSources';

afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }));

describe('useTurbopassHealth', () => {
  it('reads the sources and the official-set countries from one /health call', async () => {
    answer({ sources: { official: true, overture: true, geoapify: false }, official: { RW: {}, KE: {} } });
    const { result } = renderHook(() => useTurbopassHealth('/tp'));
    expect(result.current).toBeNull(); // still asking
    await waitFor(() => expect(result.current).toEqual({ sources: ['official', 'overture'], officialCountries: ['KE', 'RW'] }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/tp/health');
  });

  it('is empty when the SPA answers instead (turbopass not deployed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError('not JSON')) }));
    const { result } = renderHook(() => useTurbopassHealth('/tp'));
    await waitFor(() => expect(result.current).toEqual({ sources: [], officialCountries: [] }));
  });

  it('is empty when the service holds no data', async () => {
    answer({ sources: { overture: false, official: false, geoapify: false }, official: null });
    const { result } = renderHook(() => useTurbopassHealth('/tp'));
    await waitFor(() => expect(result.current).toEqual({ sources: [], officialCountries: [] }));
  });
});
