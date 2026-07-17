// Link styled as a call-to-action button.
//
// CTAs on the landing page are navigations, not actions, so they must be real
// anchors (middle-click, copy-link, SEO) — hence a styled LandingLink instead
// of the v2 <Button>. Variants mirror the government identity: yellow accent
// for the primary ask, green for secondary emphasis, outline flavours for
// light and dark surfaces.

import * as React from "react";
import { cn } from "@egovernments/digit-ui-components-v2";
import { LandingLink, LandingLinkProps } from "./LandingLink";
import { FOCUS_RING, FOCUS_RING_DARK } from "../tokens";

type CtaVariant = "accent" | "primary" | "outline" | "inverse" | "subtle";
type CtaSize = "md" | "lg";

export interface CtaLinkProps extends LandingLinkProps {
  variant?: CtaVariant;
  size?: CtaSize;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

const BASE =
  // no-underline + m-0 defend against legacy global anchor styles (preflight is off)
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold no-underline " +
  "rounded-[var(--pgrl-radius)] motion-safe:transition-colors select-none m-0";

// Anchor colors are `!important` (Tailwind `!` modifier): the app's legacy
// overrides.css styles `a:not(.digit-button):not(.button)` at specificity
// 0-2-1, which beats scoped utilities (0-2-0) and would repaint every link in
// the tenant's tertiary-link color.
const VARIANTS: Record<CtaVariant, string> = {
  accent:
    "bg-[hsl(var(--pgrl-accent))] !text-[hsl(var(--pgrl-on-accent))] hover:bg-[hsl(var(--pgrl-accent-hover))] shadow-sm " +
    FOCUS_RING_DARK,
  primary:
    "bg-[hsl(var(--pgrl-primary))] !text-[hsl(var(--pgrl-on-primary))] hover:bg-[hsl(var(--pgrl-primary)/0.9)] shadow-sm " +
    FOCUS_RING,
  outline:
    "border border-solid border-[hsl(var(--pgrl-primary))] bg-transparent !text-[hsl(var(--pgrl-primary))] " +
    "hover:bg-[hsl(var(--pgrl-primary)/0.08)] " +
    FOCUS_RING,
  inverse:
    // Hover darkens to deep (not white-tint): white text over a white tint on
    // the gradient's light end drops below 4.5:1.
    "border border-solid border-[hsl(var(--pgrl-on-primary)/0.65)] bg-transparent !text-[hsl(var(--pgrl-on-primary))] " +
    "hover:bg-[hsl(var(--pgrl-deep))] hover:border-[hsl(var(--pgrl-on-primary))] " +
    FOCUS_RING_DARK,
  subtle:
    "bg-transparent !text-[hsl(var(--pgrl-primary))] underline-offset-4 hover:underline px-0 min-h-[24px] " + FOCUS_RING,
};

const SIZES: Record<CtaSize, string> = {
  md: "min-h-[44px] px-5 text-sm",
  lg: "min-h-[48px] px-6 text-base",
};

export const CtaLink = React.forwardRef<HTMLAnchorElement, CtaLinkProps>(
  ({ variant = "accent", size = "md", leading, trailing, className, children, ...rest }, ref) => (
    <LandingLink
      ref={ref}
      className={cn(BASE, VARIANTS[variant], variant !== "subtle" && SIZES[size], className)}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </LandingLink>
  )
);
CtaLink.displayName = "CtaLink";
