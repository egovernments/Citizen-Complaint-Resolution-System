import type { ComponentType, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Icon = ComponentType<{ className?: string }>;

/** The dashed "nothing here yet" panel a step shows before it has records. */
export function EmptyState({ icon: IconComponent, title, children }: { icon: Icon; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-md bg-primary/10 text-primary flex items-center justify-center">
        <IconComponent className="w-6 h-6" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * One way to add a step's records ("Create manually", "Upload from Excel",
 * a source that is coming soon). A card whose action is `null` shows
 * "Coming soon" instead of a button.
 */
export function OptionCard({
  icon: IconComponent,
  title,
  children,
  action,
  onClick,
}: {
  icon: Icon;
  title: string;
  children: ReactNode;
  action: string | null;
  onClick?: () => void;
}) {
  const soon = action === null;
  return (
    <div className={`flex flex-col rounded-lg border border-border bg-card p-4 ${soon ? 'opacity-75' : ''}`}>
      <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
        <IconComponent className="w-5 h-5" />
      </div>
      <h4 className="mt-3 text-base font-medium text-foreground">{title}</h4>
      <p className="mt-1 flex-1 text-sm leading-5 text-muted-foreground">{children}</p>
      <div className="mt-4">
        {soon ? (
          <span className="inline-flex h-9 items-center px-3 text-sm font-medium text-primary/70">Coming soon</span>
        ) : (
          <Button variant="outline" size="sm" onClick={onClick} className="h-9 gap-1.5 px-3">
            {action}
            <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A step's footer: Back on the left of the main action, as in the design.
 * `hint` explains a disabled continue.
 */
export function StepActions({
  onBack,
  onContinue,
  continueLabel = 'Save and continue',
  busy = false,
  disabled = false,
  hint,
}: {
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      {onBack && (
        <Button variant="ghost" onClick={onBack} className="h-10 gap-1.5 px-3 text-primary hover:text-primary">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
      )}
      <Button onClick={onContinue} disabled={busy || disabled} className="h-10 gap-2 px-5">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        {continueLabel}
      </Button>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
