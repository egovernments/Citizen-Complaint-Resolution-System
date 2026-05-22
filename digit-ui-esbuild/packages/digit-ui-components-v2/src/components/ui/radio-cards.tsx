import * as React from "react";
import { cn } from "../../lib/cn";
import { Check } from "lucide-react";

export interface RadioCardOption<TValue extends string = string> {
  value: TValue;
  label: React.ReactNode;
  /** Optional secondary line under the label. */
  description?: React.ReactNode;
  /** Optional icon shown on the left. */
  icon?: React.ReactNode;
  /** Disable an individual option. */
  disabled?: boolean;
}

export interface RadioCardsProps<TValue extends string = string> {
  /** A single name to bind the underlying radio inputs together. */
  name: string;
  /** Currently selected value. */
  value?: TValue;
  /** Fires with the new value. */
  onValueChange?: (value: TValue) => void;
  options: RadioCardOption<TValue>[];
  /** Stacked (default) is best for long lists / mobile. Grid for short menus on wider screens. */
  layout?: "stack" | "grid";
  className?: string;
}

/**
 * Radio cards — large tap targets that read naturally on mobile and read as a
 * proper radio group via keyboard / screen reader.
 *
 * Picks one of `options.value` and reports the change via `onValueChange`.
 * Renders native `<input type="radio">` for keyboard and form support but the
 * visible chrome is the styled card so the user never sees a tiny dot.
 */
export function RadioCards<TValue extends string = string>({
  name,
  value,
  onValueChange,
  options,
  layout = "stack",
  className,
}: RadioCardsProps<TValue>) {
  return (
    <div
      role="radiogroup"
      className={cn(
        layout === "grid"
          ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
          : "flex flex-col gap-3",
        className
      )}
    >
      {options.map((option) => {
        const isChecked = option.value === value;
        const inputId = `${name}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={inputId}
            className={cn(
              "group relative flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-4 text-left transition-all",
              "hover:border-primary/60 hover:shadow-sm",
              "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
              isChecked
                ? "border-primary ring-1 ring-primary/40 bg-primary/5"
                : "border-border",
              option.disabled && "cursor-not-allowed opacity-60 hover:border-border hover:shadow-none"
            )}
          >
            <input
              id={inputId}
              type="radio"
              name={name}
              value={option.value}
              checked={isChecked}
              disabled={option.disabled}
              onChange={() => onValueChange?.(option.value)}
              // Use inline styles so legacy `input[type="radio"]` overrides
              // in digit-ui-css.css can't show the native radio. The label
              // wrapper handles all clicks; the input only exists for form
              // submission semantics.
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0,0,0,0)",
                whiteSpace: "nowrap",
                border: 0,
                opacity: 0,
                pointerEvents: "none",
              }}
              tabIndex={-1}
            />
            {option.icon ? (
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors",
                  isChecked
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
                aria-hidden
              >
                {option.icon}
              </span>
            ) : null}
            <div className="flex-1 min-w-0">
              <div
                className={cn(
                  "text-sm font-medium",
                  isChecked ? "text-foreground" : "text-foreground"
                )}
              >
                {option.label}
              </div>
              {option.description ? (
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {option.description}
                </div>
              ) : null}
            </div>
            <span
              className={cn(
                "shrink-0 flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                isChecked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background"
              )}
              aria-hidden
            >
              {isChecked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
