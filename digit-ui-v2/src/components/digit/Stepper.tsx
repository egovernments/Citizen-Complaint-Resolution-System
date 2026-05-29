/**
 * Stepper — horizontal step indicator + next/back controls.
 *
 * Used by CitizenComplaintCreatePage; framework-agnostic, takes the
 * current step + step labels + handlers and renders the chrome. Step
 * content is the children prop.
 *
 * Visual model:
 *   ● ─── ○ ─── ○ ─── ○       (filled = completed, ring = current)
 *   Type  Details  Location   Review
 */
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StepperProps {
  steps: string[];
  current: number;
  children: React.ReactNode;
  onNext: () => void | Promise<void>;
  onBack: () => void;
  /** "Next" label on the final step becomes whatever this is (e.g. "Submit"). */
  finalLabel?: string;
  isSubmitting?: boolean;
}

export function Stepper({
  steps,
  current,
  children,
  onNext,
  onBack,
  finalLabel = 'Submit',
  isSubmitting = false,
}: StepperProps) {
  const isLast = current === steps.length - 1;

  return (
    <div className="space-y-6">
      {/* Indicator */}
      <div className="flex items-center justify-between">
        {steps.map((label, i) => {
          const completed = i < current;
          const active = i === current;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center min-w-0">
                <div
                  className={cn(
                    'h-9 w-9 rounded-full flex items-center justify-center border-2 transition-colors shrink-0',
                    completed && 'bg-primary border-primary text-primary-foreground',
                    active && !completed && 'border-primary text-primary bg-primary/5',
                    !completed && !active && 'border-muted-foreground/30 text-muted-foreground',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  {completed ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-sm font-semibold">{i + 1}</span>}
                </div>
                <span
                  className={cn(
                    'mt-1 text-xs text-center max-w-[100px]',
                    active ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    'h-px flex-1 mx-2 transition-colors',
                    i < current ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step body */}
      <div>{children}</div>

      {/* Controls */}
      <div className="flex items-center justify-between pt-4 border-t">
        <Button type="button" variant="ghost" onClick={onBack} disabled={current === 0 || isSubmitting}>
          Back
        </Button>
        <Button type="button" onClick={() => onNext()} disabled={isSubmitting}>
          {isLast ? (isSubmitting ? 'Submitting…' : finalLabel) : 'Next'}
        </Button>
      </div>
    </div>
  );
}
