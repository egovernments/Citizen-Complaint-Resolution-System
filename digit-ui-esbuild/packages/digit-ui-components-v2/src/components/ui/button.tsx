import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  // Base — focus ring, disabled, transitions, font weight, alignment
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
    "disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95 shadow-sm",
        secondary:
          "bg-muted text-foreground hover:bg-muted/80 active:bg-muted",
        outline:
          "border border-input bg-background text-foreground hover:bg-muted hover:text-foreground",
        ghost: "text-foreground hover:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        link: "text-primary underline-offset-4 hover:underline px-0 py-0 h-auto",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
      width: {
        auto: "",
        full: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      width: "auto",
    },
  }
);

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size">,
    VariantProps<typeof buttonVariants> {
  /** Show a leading icon (e.g. lucide-react icon component). */
  leading?: React.ReactNode;
  /** Show a trailing icon. */
  trailing?: React.ReactNode;
  /** When true, render a spinner and disable the button. */
  loading?: boolean;
}

/**
 * Modern button. Always use `<Button>` instead of native `<button>` inside the
 * v2 scope so we can evolve states (loading, icon spacing, sizes) centrally.
 *
 * The `primary` variant deliberately bypasses the Tailwind `bg-primary` token
 * (which resolves to a generic v2 orange) and pulls straight from the
 * tenant's MDMS button vars instead, so the v2 Next/Submit CTA matches
 * naipepea's kenya-yellow legacy button pixel-for-pixel:
 *
 *   bg    = var(--color-button-primary-bg-default, --color-primary-2, #FEC931)
 *   text  = var(--color-text-primary, #0B0C0C) — every other yellow CTA on
 *           naipepea (the classless-button override rule in overrides.css,
 *           Save / Search / submit-bar buttons) reads dark text on yellow,
 *           so the v2 Next/Submit matches that convention rather than the
 *           old `.digit-button-primary` inner-h2 white-on-yellow.
 *
 * Hover / active also route through the same vars so a tenant changing
 * `--color-button-primary-bg-hover` retints the v2 button automatically.
 */
const PRIMARY_INLINE_STYLE: React.CSSProperties = {
  backgroundColor:
    "var(--color-button-primary-bg-default, var(--color-primary-2, #FEC931))",
  color: "var(--color-text-primary, #0B0C0C)",
};
const PRIMARY_HOVER_BG =
  "var(--color-button-primary-bg-hover, var(--color-primary-2, #E6B800))";

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      width,
      leading,
      trailing,
      loading,
      disabled,
      children,
      style,
      onMouseEnter,
      onMouseLeave,
      type,
      ...props
    },
    ref
  ) => {
    const isPrimary = (variant ?? "primary") === "primary";
    const mergedStyle: React.CSSProperties = isPrimary
      ? { ...PRIMARY_INLINE_STYLE, ...style }
      : style ?? {};
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(buttonVariants({ variant, size, width }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
        style={mergedStyle}
        onMouseEnter={(e) => {
          if (isPrimary && !disabled && !loading) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              PRIMARY_HOVER_BG;
          }
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          if (isPrimary) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              PRIMARY_INLINE_STYLE.backgroundColor as string;
          }
          onMouseLeave?.(e);
        }}
      >
        {loading ? (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        ) : (
          leading
        )}
        {children}
        {!loading && trailing}
      </button>
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
