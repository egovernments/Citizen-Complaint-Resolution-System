import * as React from "react";
import { cn } from "../../lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type ?? "text"}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm transition-colors",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:border-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          invalid && "border-destructive focus-visible:ring-destructive",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
