import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * The top of every onboarding step: a small section eyebrow, the step's name,
 * one line on what it is for, and a "Completed" pill once it is done.
 */
export function StepHeader({
  eyebrow,
  title,
  done = false,
  children,
}: {
  eyebrow: string;
  title: string;
  done?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.5px] text-muted-foreground">{eyebrow}</p>
        {done && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
            <Check className="w-3 h-3" strokeWidth={3} />
            Completed
          </span>
        )}
      </div>
      <h2 className="text-3xl font-bold font-condensed text-foreground">{title}</h2>
      {children && <p className="max-w-xl text-sm leading-6 text-muted-foreground">{children}</p>}
    </header>
  );
}
