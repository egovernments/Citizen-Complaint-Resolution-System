import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '@/api/onboarding';
import { KEEP_ALIVE_MS, useIdentityKeepAlive } from './keepAlive';

vi.mock('@/api/onboarding', () => ({ session: vi.fn(async () => ({ authenticated: true })) }));

const click = () => window.dispatchEvent(new Event('pointerdown'));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(session).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('identity keep-alive (#2456)', () => {
  it('checks in on activity at most once per interval', () => {
    renderHook(() => useIdentityKeepAlive(true));
    click();
    expect(session).not.toHaveBeenCalled();
    vi.advanceTimersByTime(KEEP_ALIVE_MS);
    click();
    click();
    expect(session).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while nobody is working, and when signed out', () => {
    const { rerender } = renderHook(({ active }) => useIdentityKeepAlive(active), { initialProps: { active: true } });
    vi.advanceTimersByTime(6 * KEEP_ALIVE_MS);
    expect(session).not.toHaveBeenCalled();
    rerender({ active: false });
    click();
    expect(session).not.toHaveBeenCalled();
  });
});
