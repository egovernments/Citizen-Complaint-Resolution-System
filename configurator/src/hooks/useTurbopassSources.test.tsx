import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTurbopassSources } from './useTurbopassSources';

afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }));

describe('useTurbopassSources', () => {
  it('lists what /health says the server can answer', async () => {
    answer({ sources: { official: true, overture: true, geoapify: false } });
    const { result } = renderHook(() => useTurbopassSources('/tp'));
    expect(result.current).toBeNull(); // still asking
    await waitFor(() => expect(result.current).toEqual(['official', 'overture']));
    expect(fetch).toHaveBeenCalledWith('/tp/health');
  });

  it('is empty when the SPA answers instead (turbopass not deployed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError('not JSON')) }));
    const { result } = renderHook(() => useTurbopassSources('/tp'));
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it('is empty when the service holds no data', async () => {
    answer({ sources: { overture: false, official: false, geoapify: false } });
    const { result } = renderHook(() => useTurbopassSources('/tp'));
    await waitFor(() => expect(result.current).toEqual([]));
  });
});
