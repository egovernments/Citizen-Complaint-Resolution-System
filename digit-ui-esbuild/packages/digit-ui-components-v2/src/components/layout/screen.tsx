import * as React from "react";
import { cn } from "../../lib/cn";
import { ChevronLeft } from "lucide-react";

export interface BackLinkProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: React.ReactNode;
}

/**
 * Lightweight back affordance — text + chevron, defaults to going back one step
 * via window.history when no onClick is provided.
 */
export const BackLink = React.forwardRef<HTMLButtonElement, BackLinkProps>(
  ({ className, label = "Back", onClick, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          if (onClick) {
            onClick(e);
          } else if (typeof window !== "undefined") {
            window.history.back();
          }
        }}
        className={cn(
          "inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors",
          "hover:text-foreground focus-visible:outline-none focus-visible:text-foreground",
          className
        )}
        {...props}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {label}
      </button>
    );
  }
);
BackLink.displayName = "BackLink";

export interface ScreenContainerProps {
  className?: string;
  children: React.ReactNode;
  /** Kept for API compatibility; v2 no longer uses a sticky footer. */
  withFooter?: boolean;
}

/**
 * Top-level wrapper for a v2 screen. A simple flex column that grows to
 * fit its content. Long forms are handled by global page scroll (the
 * earlier body-only-scroll layout was reverted after testers flagged the
 * regression in PR #99 follow-up). FormFooter flows under the form body
 * naturally; if it should sit at the bottom of a tall column the
 * consumer can opt in by setting min-height on this container.
 */
export function ScreenContainer({ className, children }: ScreenContainerProps) {
  return (
    <div
      className={cn("v2-scope w-full", className)}
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

export interface ScreenHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}

export function ScreenHeader({ title, description, className }: ScreenHeaderProps) {
  return (
    <header className={cn("space-y-1.5", className)}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">{title}</h1>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </header>
  );
}

export interface FormFooterProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * Action row for multi-step forms.
 *
 * Designed to sit at the very end of a flex-column ScreenContainer. With
 * `marginTop: auto` on a flex item, the row is pushed to the bottom of the
 * column even when the form above it is short — so Cancel / Continue
 * always show just above the page footer, never floating mid-page.
 *
 * Solid surface + top border so the buttons read clearly over scrolling
 * form content. No glassmorphism, no fixed positioning.
 */
export function FormFooter({ className, children }: FormFooterProps) {
  return (
    <div
      style={{
        marginTop: "auto",
        flexShrink: 0,
        // Transparent surface — sits over whatever the page bg is. The
        // top border still gives visual separation from the form body.
        backgroundColor: "transparent",
        borderTop: "1px solid var(--color-border, #d6d5d4)",
      }}
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3",
        className
      )}
    >
      {children}
    </div>
  );
}
