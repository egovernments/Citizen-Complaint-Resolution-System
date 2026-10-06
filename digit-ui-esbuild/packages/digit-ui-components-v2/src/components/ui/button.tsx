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
        // DIGIT Secondary: brand stroke, brand label, no fill. `outline` is
        // the same thing under its shadcn name — both call sites mean "the
        // quieter action next to the CTA", and having them render differently
        // was how Cancel ended up grey while Save was brand.
        //
        // Colour is applied inline from the tenant's button tokens rather than
        // through `border-primary`/`text-primary`: the Tailwind `primary`
        // token is a generic v2 orange, which is exactly why the `primary`
        // variant already bypasses it. Using it here would paint a Kenyan
        // deployment's Cancel button orange.
        secondary: "border bg-transparent",
        outline: "border bg-transparent",
        // DIGIT Tertiary: brand label, no fill, no stroke.
        ghost: "bg-transparent",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        // Underlined at rest, not only on hover — a link that only looks like
        // one under the pointer is not discoverable.
        link: "underline underline-offset-4 px-0 py-0 h-auto",
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
  // The label follows the theme's own button-text token. It used to be
  // --color-text-primary, which only read correctly while the brand surface
  // was light (naipepea's yellow); on a dark brand like Bomet's #2563EB that
  // put near-black on blue. Falling back to the old value keeps every tenant
  // that never set button-primary-text exactly where it was.
  color: "var(--color-button-primary-text, var(--color-text-primary, #0B0C0C))",
};
const PRIMARY_HOVER_BG =
  "var(--color-button-primary-bg-hover, var(--color-primary-2, #E6B800))";

/**
 * DIGIT Secondary and Tertiary, from the same token family as PRIMARY above.
 *
 * The theme record already ships `--color-button-secondary-border` and
 * `--color-button-secondary-text` — measured #2563EB on Bomet — and nothing
 * consumed them, so these buttons rendered from Tailwind's neutral palette
 * instead: a grey stroke with a near-black label sitting beside a brand CTA.
 *
 * There is no `--color-button-secondary-bg` in the record, which is the point:
 * an outline button has no fill of its own and should show whatever surface it
 * is placed on.
 */
const SECONDARY_BORDER =
  "var(--color-button-secondary-border, var(--color-primary-2, var(--color-primary-1, #2563EB)))";
const SECONDARY_TEXT =
  "var(--color-button-secondary-text, var(--color-primary-2, var(--color-primary-1, #2563EB)))";
const SECONDARY_INLINE_STYLE: React.CSSProperties = {
  borderColor: SECONDARY_BORDER,
  color: SECONDARY_TEXT,
};
const TERTIARY_INLINE_STYLE: React.CSSProperties = { color: SECONDARY_TEXT };
/** A tint of the brand, not a second opaque fill. */
const SECONDARY_HOVER_BG =
  "var(--color-primary-1-bg, rgba(37, 99, 235, 0.08))";

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
    const resolved = variant ?? "primary";
    const isPrimary = resolved === "primary";
    const isSecondary = resolved === "secondary" || resolved === "outline";
    const isTertiary = resolved === "ghost" || resolved === "link";
    const mergedStyle: React.CSSProperties = isPrimary
      ? { ...PRIMARY_INLINE_STYLE, ...style }
      : isSecondary
        ? { ...SECONDARY_INLINE_STYLE, ...style }
        : isTertiary
          ? { ...TERTIARY_INLINE_STYLE, ...style }
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
          if (!disabled && !loading) {
            const el = e.currentTarget as HTMLButtonElement;
            if (isPrimary) el.style.backgroundColor = PRIMARY_HOVER_BG;
            // Secondary and tertiary take a tint of the brand rather than a
            // fill, so the outline still reads as an outline while hovered.
            else if (isSecondary || isTertiary) el.style.backgroundColor = SECONDARY_HOVER_BG;
          }
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLButtonElement;
          if (isPrimary) {
            el.style.backgroundColor = PRIMARY_INLINE_STYLE.backgroundColor as string;
          } else if (isSecondary || isTertiary) {
            el.style.backgroundColor = "transparent";
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
