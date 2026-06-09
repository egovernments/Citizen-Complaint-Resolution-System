import type { ReactNode } from 'react';

interface FieldSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function FieldSection({ title, children, className }: FieldSectionProps) {
  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 pb-2 border-b border-border">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

interface FieldRowProps {
  label: string;
  children: ReactNode;
}

export function FieldRow({ label, children }: FieldRowProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0 py-1">
      <dt className="text-sm font-medium text-muted-foreground sm:w-[200px] sm:flex-shrink-0">{label}</dt>
      <dd className="text-sm text-foreground">{children ?? <span className="text-muted-foreground">--</span>}</dd>
    </div>
  );
}
