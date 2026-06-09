import * as React from "react";
import { cn } from "../../lib/cn";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none text-foreground select-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    >
      {children}
      {required ? (
        <span
          className="ml-0.5 text-destructive"
          // Inline color uses the existing brand error var so a tenant can
          // retint without forking this file. Falls back to a sensible
          // red-600 only if --color-error isn't set.
          style={{ color: "var(--color-error, #d4351c)" }}
          aria-hidden
        >
          *
        </span>
      ) : null}
    </label>
  )
);
Label.displayName = "Label";
