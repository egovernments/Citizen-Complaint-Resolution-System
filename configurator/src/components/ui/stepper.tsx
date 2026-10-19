import { cn } from '@/lib/utils';

export interface StepperStep {
  /** Stable key, also the value the parent tracks. */
  id: string;
  label: string;
}

export interface StepperProps {
  steps: StepperStep[];
  /** id of the step currently showing. */
  current: string;
  className?: string;
}

/**
 * Horizontal progress header for a linear flow (CCRS#1999).
 *
 * A component rather than more inline markup: Layout.tsx hardcodes the Phase
 * 1-4 stepper into the wizard chrome, so it could not be reused here.
 *
 * Presentational only. It renders no buttons because the flows using it gate
 * forward movement on validation, and a clickable rail invites skipping.
 * Completed steps read as completed to assistive tech via aria-current and the
 * visually-hidden status text.
 */
export function Stepper({ steps, current, className }: StepperProps) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === current));

  return (
    <ol className={cn('flex gap-3', className)} aria-label="Progress">
      {steps.map((step, index) => {
        const isCurrent = index === currentIndex;
        const isComplete = index < currentIndex;
        return (
          <li key={step.id} className="flex-1" aria-current={isCurrent ? 'step' : undefined}>
            <div
              // 3px, per the reference. At the shadcn-ish 2px the rail reads as
              // a hairline rule rather than as progress.
              className={cn(
                'h-[3px] w-full rounded-full transition-colors',
                isCurrent || isComplete ? 'bg-primary' : 'bg-border',
              )}
            />
            <p
              className={cn(
                // 11px/600 with wider tracking, as the reference sets it. At
                // 12px/500 the labels competed with the field labels below.
                'mt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors',
                isCurrent ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {step.label}
              <span className="sr-only">
                {isComplete ? ' (completed)' : isCurrent ? ' (current step)' : ' (not started)'}
              </span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export default Stepper;
