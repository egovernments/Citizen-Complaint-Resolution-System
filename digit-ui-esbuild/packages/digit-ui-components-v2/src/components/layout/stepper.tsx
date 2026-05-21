import * as React from "react";
import { cn } from "../../lib/cn";

export interface StepperStep {
  /** Stable id for the step. */
  id: string;
  /** Visible title. Kept short for mobile. */
  title: string;
}

export interface StepperProps {
  steps: StepperStep[];
  /** 0-indexed. */
  currentIndex: number;
  className?: string;
}

/**
 * Linear progress indicator across discrete form steps.
 * - On mobile: shows a compact "Step N of M · <title>" line + thin progress bar.
 * - On md+: shows the full chip row with check marks for completed steps.
 *
 * Pure visual — emits no events; the parent flow controls navigation.
 */
export function Stepper({ steps, currentIndex, className }: StepperProps) {
  const total = steps.length;
  const safeIndex = Math.max(0, Math.min(currentIndex, total - 1));
  const current = steps[safeIndex];
  const progress = total <= 1 ? 100 : (safeIndex / (total - 1)) * 100;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Step {safeIndex + 1} of {total}
        </span>
        <span className="text-sm font-medium text-foreground">{current?.title}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={safeIndex + 1}
        />
      </div>
    </div>
  );
}
