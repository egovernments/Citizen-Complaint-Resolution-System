import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePostalRule } from './usePostalRule';
import { mdmsService } from '@/api';

vi.mock('@/api', () => ({
  mdmsService: {
    getPostalValidation: vi.fn(),
  },
}));

const getPostalValidation = vi.mocked(mdmsService.getPostalValidation);

type AnyWindow = Window & {
  __DIGIT_FORM_VALIDATIONS?: Record<string, { pattern: string } | undefined>;
};
const win = window as unknown as AnyWindow;

beforeEach(() => {
  getPostalValidation.mockReset();
});

afterEach(() => {
  delete win.__DIGIT_FORM_VALIDATIONS;
});

describe('usePostalRule — FormValidations mirror', () => {
  it('mirrors a seeded postalCode row onto window.__DIGIT_FORM_VALIDATIONS', async () => {
    getPostalValidation.mockResolvedValue({ pattern: '^[0-9]{4}$' });

    renderHook(() => usePostalRule('mz'));

    await waitFor(() =>
      expect(win.__DIGIT_FORM_VALIDATIONS?.postalCode).toEqual({ pattern: '^[0-9]{4}$' })
    );
    expect(getPostalValidation).toHaveBeenCalledWith('mz');
  });

  it('leaves the channel empty when no row is seeded (the stock case)', async () => {
    getPostalValidation.mockResolvedValue(null);

    renderHook(() => usePostalRule('ke.nairobi'));

    await waitFor(() => expect(getPostalValidation).toHaveBeenCalled());
    expect(win.__DIGIT_FORM_VALIDATIONS?.postalCode).toBeUndefined();
  });

  it('leaves the channel empty on a failed fetch — MDMS problems can never brick the form', async () => {
    getPostalValidation.mockRejectedValue(new Error('mdms down'));

    renderHook(() => usePostalRule('ke.nairobi'));

    await waitFor(() => expect(getPostalValidation).toHaveBeenCalled());
    expect(win.__DIGIT_FORM_VALIDATIONS?.postalCode).toBeUndefined();
  });

  it("clears the previous tenant's rule on tenant switch before the new fetch lands", async () => {
    let resolveSecond!: (v: { pattern: string } | null) => void;
    getPostalValidation
      .mockResolvedValueOnce({ pattern: '^[0-9]{4}$' })
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; })
      );

    const { rerender } = renderHook(({ tenant }) => usePostalRule(tenant), {
      initialProps: { tenant: 'mz' },
    });
    await waitFor(() =>
      expect(win.__DIGIT_FORM_VALIDATIONS?.postalCode).toEqual({ pattern: '^[0-9]{4}$' })
    );

    rerender({ tenant: 'ke' });
    // The mz rule must be gone immediately — globalConfigs covers the gap.
    expect(win.__DIGIT_FORM_VALIDATIONS?.postalCode).toBeUndefined();

    resolveSecond({ pattern: '^[0-9]{5}$' });
    await waitFor(() =>
      expect(win.__DIGIT_FORM_VALIDATIONS?.postalCode).toEqual({ pattern: '^[0-9]{5}$' })
    );
  });

  it('ignores a stale fetch that resolves after unmount', async () => {
    let resolveFetch!: (v: { pattern: string } | null) => void;
    getPostalValidation.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; })
    );

    const { unmount } = renderHook(() => usePostalRule('mz'));
    await waitFor(() => expect(getPostalValidation).toHaveBeenCalled());
    unmount();

    resolveFetch({ pattern: '^[0-9]{4}$' });
    // Give the resolved promise a microtask to (not) apply.
    await Promise.resolve();
    expect(win.__DIGIT_FORM_VALIDATIONS?.postalCode).toBeUndefined();
  });

  it('does nothing without a tenant', () => {
    renderHook(() => usePostalRule(''));
    expect(getPostalValidation).not.toHaveBeenCalled();
  });
});
