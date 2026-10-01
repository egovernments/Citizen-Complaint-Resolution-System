import type { ComponentType, ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { rowTone } from './railStyles';
import { DigitFooter } from '@/components/DigitFooter';

/** The 3px primary bar on the current row's left edge. */
export function ActiveBar() {
  return <span aria-hidden="true" className="absolute left-0 inset-y-0 w-[3px] bg-primary" />;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="h-8 px-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * A full-bleed rail row: 36px for one line of text, growing when a long label
 * wraps (text-left keeps the wrapped line on the label's left edge; buttons
 * centre text by default). `leading` replaces the icon, for rows that show a
 * status mark instead.
 */
export function NavRow({
  icon: Icon,
  leading,
  label,
  active,
  collapsed,
  disabled = false,
  onClick,
  trailing,
}: {
  icon?: ComponentType<{ className?: string }>;
  leading?: ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  disabled?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`relative w-full min-h-9 flex items-center gap-3 py-2 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
        collapsed ? 'justify-center px-0' : 'px-4'
      } ${disabled ? 'text-muted-foreground cursor-not-allowed' : rowTone(active)}`}
    >
      {active && <ActiveBar />}
      {leading ?? (Icon && <Icon className="w-4 h-4 flex-shrink-0" />)}
      {!collapsed && <span className="flex-1 min-w-0">{label}</span>}
      {!collapsed && trailing}
    </button>
  );
}

/** Dims the page behind the phone drawer; a tap on it closes the drawer. */
export function RailBackdrop({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} />;
}

/** The top bar's menu button, shown below md where the rail is a drawer. */
export function RailMenuButton({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={open}
      className="md:hidden -ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Menu className="w-5 h-5" />
    </button>
  );
}

/** The drawer's own close button, in place of the collapse toggle below md. */
export function RailCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="md:hidden inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-secondary hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <X className="w-4 h-4" />
    </button>
  );
}

/** "Powered by DIGIT" (CCRS#1841) closing the rail, as the DIGIT console does. Too wide for the collapsed rail. */
export function RailPoweredBy({ collapsed }: { collapsed: boolean }) {
  if (collapsed) return null;
  return (
    <div className="border-t border-muted p-3 flex items-center justify-center">
      <DigitFooter />
    </div>
  );
}
