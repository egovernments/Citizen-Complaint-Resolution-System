import * as React from "react";

export interface MultiStepFormState<TData> {
  data: TData;
  setData: React.Dispatch<React.SetStateAction<TData>>;
  /** Merge a partial update into the form data. */
  patch: (partial: Partial<TData>) => void;
  /** 0-indexed current step. */
  currentIndex: number;
  /** True while at the first step. */
  isFirst: boolean;
  /** True while at the last step. */
  isLast: boolean;
  /** Advance to the next step. No-op if at the last step. */
  next: () => void;
  /** Step back. No-op if at the first step. */
  back: () => void;
  /** Jump to an arbitrary step index. */
  goTo: (index: number) => void;
}

export interface UseMultiStepFormOptions<TData> {
  steps: ReadonlyArray<{ id: string }>;
  initialData: TData;
  /**
   * Optional callback fired when the user navigates back from the first step.
   * Useful for routing back out of the flow entirely (e.g. window.history.back()).
   */
  onExit?: () => void;
}

export function useMultiStepForm<TData>({
  steps,
  initialData,
  onExit,
}: UseMultiStepFormOptions<TData>): MultiStepFormState<TData> {
  const [data, setData] = React.useState<TData>(initialData);
  const [currentIndex, setCurrentIndex] = React.useState(0);

  const patch = React.useCallback((partial: Partial<TData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  const next = React.useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const back = React.useCallback(() => {
    setCurrentIndex((i) => {
      if (i === 0) {
        onExit?.();
        return i;
      }
      return i - 1;
    });
  }, [onExit]);

  const goTo = React.useCallback(
    (index: number) => {
      const safe = Math.max(0, Math.min(index, steps.length - 1));
      setCurrentIndex(safe);
    },
    [steps.length]
  );

  return {
    data,
    setData,
    patch,
    currentIndex,
    isFirst: currentIndex === 0,
    isLast: currentIndex === steps.length - 1,
    next,
    back,
    goTo,
  };
}
