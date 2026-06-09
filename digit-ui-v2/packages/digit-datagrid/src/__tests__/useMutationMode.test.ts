import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock ra-core
const mockUpdate = vi.fn().mockResolvedValue({ data: { id: '1' } });
const mockDelete = vi.fn().mockResolvedValue({ data: { id: '1' } });

vi.mock('ra-core', () => ({
  useUpdate: () => [mockUpdate],
  useDelete: () => [mockDelete],
}));

// Mock toast
vi.mock('../hooks/use-toast', () => ({
  toast: vi.fn().mockReturnValue({
    id: 'toast-1',
    dismiss: vi.fn(),
    update: vi.fn(),
  }),
}));

// Mock ToastAction
vi.mock('@/primitives/toast', () => ({
  ToastAction: ({ onClick, children }: { onClick: () => void; children: string }) => ({
    type: 'ToastAction',
    props: { onClick, children },
  }),
}));

import { useMutationMode } from '../editing/useMutationMode';
import { toast as mockToast } from '../hooks/use-toast';

describe('useMutationMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('pessimistic mode', () => {
    it('calls update immediately and waits', async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'pessimistic', onSuccess })
      );

      const updateParams = {
        id: '1',
        data: { name: 'Test' },
        previousData: { id: '1', name: 'Old' },
      };

      await act(async () => {
        await result.current.mutate('posts', updateParams);
      });

      expect(mockUpdate).toHaveBeenCalledWith('posts', updateParams);
      expect(onSuccess).toHaveBeenCalledWith({ id: '1' });
    });

    it('calls onError on failure', async () => {
      const onError = vi.fn();
      const error = new Error('Update failed');
      mockUpdate.mockRejectedValueOnce(error);

      const { result } = renderHook(() =>
        useMutationMode({ mode: 'pessimistic', onError })
      );

      const updateParams = {
        id: '1',
        data: { name: 'Test' },
        previousData: { id: '1', name: 'Old' },
      };

      await act(async () => {
        try {
          await result.current.mutate('posts', updateParams);
        } catch (e) {
          // Expected to throw
        }
      });

      expect(onError).toHaveBeenCalledWith(error);
    });

    it('works with deleteMutate', async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'pessimistic', onSuccess })
      );

      const deleteParams = {
        id: '1',
        previousData: { id: '1', name: 'Test' },
      };

      await act(async () => {
        await result.current.deleteMutate('posts', deleteParams);
      });

      expect(mockDelete).toHaveBeenCalledWith('posts', deleteParams);
      expect(onSuccess).toHaveBeenCalledWith({ id: '1' });
    });
  });

  describe('optimistic mode', () => {
    it('fires update in background', async () => {
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'optimistic' })
      );

      const updateParams = {
        id: '1',
        data: { name: 'Test' },
        previousData: { id: '1', name: 'Old' },
      };

      await act(async () => {
        result.current.mutate('posts', updateParams);
      });

      // Update is called immediately but not awaited
      expect(mockUpdate).toHaveBeenCalledWith('posts', updateParams);
    });

    it('shows error toast on failure', async () => {
      const error = new Error('Update failed');
      mockUpdate.mockRejectedValueOnce(error);

      const { result } = renderHook(() =>
        useMutationMode({ mode: 'optimistic' })
      );

      const updateParams = {
        id: '1',
        data: { name: 'Test' },
        previousData: { id: '1', name: 'Old' },
      };

      await act(async () => {
        result.current.mutate('posts', updateParams);
        // Wait a microtask for the promise to reject
        await Promise.resolve();
      });

      // Toast should be called with error
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Update failed',
        description: 'Update failed',
        variant: 'destructive',
      });
    });

    it('works with deleteMutate', async () => {
      const { result } = renderHook(() =>
        useMutationMode({ mode: 'optimistic' })
      );

      const deleteParams = {
        id: '1',
        previousData: { id: '1', name: 'Test' },
      };

      await act(async () => {
        result.current.deleteMutate('posts', deleteParams);
      });

      expect(mockDelete).toHaveBeenCalledWith('posts', deleteParams);
    });
  });

  describe('undoable mode (default)', () => {
    it('delays API call and shows undo toast', async () => {
      const { result } = renderHook(() => useMutationMode());

      const updateParams = {
        id: '1',
        data: { name: 'Test' },
        previousData: { id: '1', name: 'Old' },
      };

      await act(async () => {
        result.current.mutate('posts', updateParams);
      });

      // Toast is shown immediately - check that it was called with correct title/description
      expect(mockToast).toHaveBeenCalled();
      const toastCall = (mockToast as any).mock.calls[0][0];
      expect(toastCall.title).toBe('Record updated');
      expect(toastCall.description).toBe('Change will be applied in 5 seconds');
      expect(toastCall.action).toBeDefined();

      // Update is not called yet
      expect(mockUpdate).not.toHaveBeenCalled();

      // Fast-forward time
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Now update is called
      expect(mockUpdate).toHaveBeenCalledWith('posts', updateParams);
    });

    it('undo cancels API call', async () => {
      const { result } = renderHook(() => useMutationMode());

      const updateParams = {
        id: '1',
        data: { name: 'Test' },
        previousData: { id: '1', name: 'Old' },
      };

      let undoClick: (() => void) | undefined;

      mockToast.mockImplementationOnce((options: any) => {
        // Capture the onClick handler
        undoClick = options.action.props.onClick;
        return {
          id: 'toast-1',
          dismiss: vi.fn(),
          update: vi.fn(),
        };
      });

      await act(async () => {
        result.current.mutate('posts', updateParams);
      });

      // Click undo before timeout
      await act(async () => {
        undoClick?.();
      });

      // Fast-forward time
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Update should NOT be called
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('timeout fires API call', async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() =>
        useMutationMode({ undoTimeout: 3000, onSuccess })
      );

      const updateParams = {
        id: '1',
        data: { name: 'Test' },
        previousData: { id: '1', name: 'Old' },
      };

      await act(async () => {
        result.current.mutate('posts', updateParams);
      });

      const toastCall = (mockToast as any).mock.calls[0][0];
      expect(toastCall.title).toBe('Record updated');
      expect(toastCall.description).toBe('Change will be applied in 3 seconds');

      // Fast-forward time
      await act(async () => {
        vi.advanceTimersByTime(3000);
        // Allow promises to resolve
        await Promise.resolve();
      });

      // Update should be called
      expect(mockUpdate).toHaveBeenCalledWith('posts', updateParams);
      expect(onSuccess).toHaveBeenCalledWith({ id: '1' });
    });

    it('works with deleteMutate', async () => {
      const { result } = renderHook(() => useMutationMode());

      const deleteParams = {
        id: '1',
        previousData: { id: '1', name: 'Test' },
      };

      await act(async () => {
        result.current.deleteMutate('posts', deleteParams);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Record deleted',
        description: 'Change will be applied in 5 seconds',
        action: expect.any(Object),
      });

      expect(mockDelete).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(mockDelete).toHaveBeenCalledWith('posts', deleteParams);
    });
  });

  describe('transform', () => {
    it('applies transform before saving', async () => {
      const transform = vi.fn((data) => ({
        ...data,
        transformed: true,
      }));

      const { result } = renderHook(() =>
        useMutationMode({ mode: 'pessimistic', transform })
      );

      const updateParams = {
        id: '1',
        data: { name: 'Test' },
        previousData: { id: '1', name: 'Old' },
      };

      await act(async () => {
        await result.current.mutate('posts', updateParams);
      });

      expect(transform).toHaveBeenCalledWith({ name: 'Test' });
      expect(mockUpdate).toHaveBeenCalledWith('posts', {
        ...updateParams,
        data: { name: 'Test', transformed: true },
      });
    });

    it('works in undoable mode', async () => {
      const transform = vi.fn((data) => ({
        ...data,
        transformed: true,
      }));

      const { result } = renderHook(() =>
        useMutationMode({ mode: 'undoable', transform })
      );

      const updateParams = {
        id: '1',
        data: { name: 'Test' },
        previousData: { id: '1', name: 'Old' },
      };

      await act(async () => {
        result.current.mutate('posts', updateParams);
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
        // Allow promises to resolve
        await Promise.resolve();
      });

      expect(transform).toHaveBeenCalledWith({ name: 'Test' });
      expect(mockUpdate).toHaveBeenCalledWith('posts', {
        ...updateParams,
        data: { name: 'Test', transformed: true },
      });
    });
  });
});
