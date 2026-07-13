// Router-optional link atom.
//
// The landing page must be pluggable into the existing app (react-router v5)
// AND renderable standalone (docs harness, storybook, tests). Instead of
// importing <Link> — which throws outside a <Router> — we render a plain
// anchor and upgrade same-app navigations ("/...") to history.push() when a
// router context is present. External schemes (https:, tel:, mailto:) always
// use the anchor as-is.
//
// "#" is the routes.ts placeholder for not-yet-configured destinations: it
// renders as a visibly disabled, non-focusable link so unfinished deployments
// never ship a dead link that scrolls to top.

import * as React from "react";
// Single hoisted copy in this repo — context identity matches the app Router.
import { __RouterContext } from "react-router";
import { cn } from "@egovernments/digit-ui-components-v2";
import { useLandingCopy } from "../useLandingCopy";

export interface LandingLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  children?: React.ReactNode;
}

const isModifiedEvent = (e: React.MouseEvent): boolean =>
  e.metaKey || e.altKey || e.ctrlKey || e.shiftKey || e.button !== 0;

export const LandingLink = React.forwardRef<HTMLAnchorElement, LandingLinkProps>(
  ({ to, children, onClick, target, rel, className, ...rest }, ref) => {
    const { c } = useLandingCopy();
    const router = React.useContext(__RouterContext as React.Context<any>);

    const isPlaceholder = to === "#";
    const isInternal = to.startsWith("/");
    const safeRel = target === "_blank" ? rel ?? "noopener noreferrer" : rel;

    if (isPlaceholder) {
      // Disabled affordance: keep the element a link for layout, but remove it
      // from the tab order and announce the disabled state (+ why, on hover).
      return (
        <a
          ref={ref}
          role="link"
          aria-disabled="true"
          title={c("PLACEHOLDER_PENDING")}
          className={cn("cursor-not-allowed opacity-60", className)}
          {...rest}
        >
          {children}
        </a>
      );
    }

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      if (
        router?.history &&
        isInternal &&
        !isModifiedEvent(e) &&
        rest.download == null &&
        (!target || target === "_self")
      ) {
        e.preventDefault();
        router.history.push(to);
      }
    };

    // Basename-aware href: history.push applies the app basename (/digit-ui),
    // but middle-click / open-in-new-tab / copy-link use the raw anchor href —
    // createHref prepends the basename so those resolve too. Standalone (no
    // router) keeps the plain path.
    const href = isInternal && router?.history?.createHref
      ? router.history.createHref({ pathname: to })
      : to;

    return (
      <a
        ref={ref}
        href={href}
        onClick={handleClick}
        target={target}
        rel={safeRel}
        className={className}
        {...rest}
      >
        {children}
        {/* New-window announcement for every _blank link, centralized here. */}
        {target === "_blank" && <span className="sr-only"> ({c("EXTERNAL_LINK_NOTE")})</span>}
      </a>
    );
  }
);
LandingLink.displayName = "LandingLink";
