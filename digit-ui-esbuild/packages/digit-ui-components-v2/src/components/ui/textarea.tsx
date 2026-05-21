import * as React from "react";
import { cn } from "../../lib/cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm transition-colors",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:border-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "resize-y",
          invalid && "border-destructive focus-visible:ring-destructive",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
