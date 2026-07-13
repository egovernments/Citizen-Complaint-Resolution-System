// Masthead + primary navigation.
//
// Desktop: white masthead (emblem, portal identity, motto) with a green nav
// bar underneath; the nav bar is sticky so the primary actions stay reachable
// on long scrolls. Active item carries the yellow underline indicator
// (desktop) / yellow left bar (mobile — the bg shade change alone is only
// ~2.2:1, below the 3:1 non-text minimum).
// Mobile: nav collapses into an accessible disclosure menu (aria-expanded /
// aria-controls, Escape closes and restores focus to the trigger).
//
// Structure note: the <nav> is a SIBLING of <header>, not a child — sticky
// positioning is constrained to the parent box, so a sticky nav inside the
// header would have zero travel and never stick. The header element also
// carries font-sans explicitly: the vendored legacy CSS has a bare
// `header { font-family: "Roboto Condensed" ... }` element rule that direct-
// targets the element and would otherwise retype the masthead.
//
// In-shell mounting: if the page renders under an app chrome with its own
// fixed topbar, set `--pgrl-nav-offset` (e.g. "82px") so the sticky nav pins
// below it instead of underneath it.

import * as React from "react";
import { Menu, X, Landmark } from "lucide-react";
import { cn } from "@egovernments/digit-ui-components-v2";
import { __RouterContext } from "react-router";
import { LandingLink } from "./LandingLink";
import { NAV_ITEMS } from "../content";
import { useLandingCopy } from "../useLandingCopy";
import { LandingRoutes } from "../routes";
import { CONTAINER, FOCUS_RING, FOCUS_RING_DARK } from "../tokens";

export interface LandingHeaderProps {
  routes: LandingRoutes;
  /** Emblem/crest image URL; falls back to a Landmark glyph when absent. */
  emblemUrl?: string;
  /** Config-driven nav items; absent => the built-in NAV_ITEMS (unchanged). */
  navItems?: any[];
}

const MENU_ID = "pgr-landing-nav-menu";

export function LandingHeader({ routes, emblemUrl, navItems }: LandingHeaderProps) {
  const items: any[] = navItems ?? NAV_ITEMS;
  const { c } = useLandingCopy();
  const router = React.useContext(__RouterContext as React.Context<any>);
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const currentPath: string =
    router?.location?.pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");

  // Exact match, or a true path-segment prefix ("/x/y" matches "/x/y/z" but
  // never a sibling like "/x/y-other").
  const isActive = (to: string) =>
    to !== "#" && (currentPath === to || currentPath.startsWith(to + "/"));

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header className="bg-[hsl(var(--pgrl-surface))] font-sans">
        {/* Masthead */}
        <div className={cn(CONTAINER, "flex items-center justify-between gap-4 py-4")}>
          <LandingLink
            to={routes.HOME}
            className={cn("flex items-center gap-3 no-underline", FOCUS_RING, "rounded-[var(--pgrl-radius)]")}
          >
            {emblemUrl ? (
              <img src={emblemUrl} alt="" className="h-12 w-12 shrink-0 object-contain" />
            ) : (
              <span
                aria-hidden
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--pgrl-primary)/0.1)]"
              >
                <Landmark className="h-6 w-6 text-[hsl(var(--pgrl-primary))]" />
              </span>
            )}
            <span className="flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--pgrl-ink-soft))]">
                {c("GOV_NAME")}
              </span>
              <span className="text-lg font-bold leading-tight text-[hsl(var(--pgrl-deep))] sm:text-xl">
                {c("PORTAL_NAME")}
              </span>
              <span className="hidden text-xs text-[hsl(var(--pgrl-ink-soft))] sm:block">
                {c("ORG_NAMES")} · {c("TAGLINE")}
              </span>
            </span>
          </LandingLink>

          <p className="m-0 hidden text-right lg:block">
            <span className="block text-sm font-semibold text-[hsl(var(--pgrl-deep))]">{c("TAGLINE")}</span>
            {/* Brand green, not yellow: accent on white is ~2.2:1 — fails AA. */}
            <span className="block text-xs font-semibold uppercase tracking-widest text-[hsl(var(--pgrl-primary))]">
              {c("MOTTO_VALUES")}
            </span>
          </p>

          {/* Mobile menu trigger */}
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-controls={MENU_ID}
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "m-0 flex h-11 w-11 cursor-pointer items-center justify-center rounded-[var(--pgrl-radius)]",
              "border border-solid border-[hsl(var(--pgrl-line))] bg-transparent text-[hsl(var(--pgrl-deep))] md:hidden",
              FOCUS_RING
            )}
          >
            {open ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
            <span className="sr-only">{open ? c("NAV_MENU_CLOSE") : c("NAV_MENU_OPEN")}</span>
          </button>
        </div>
      </header>

      {/* Primary nav — sticky on scroll (sibling of the header, see note above) */}
      <nav
        aria-label={c("ARIA_MAIN_NAV")}
        className="sticky top-[var(--pgrl-nav-offset,0px)] z-40 bg-[hsl(var(--pgrl-primary))] shadow-sm"
      >
        <ul
          id={MENU_ID}
          className={cn(
            CONTAINER,
            "m-0 list-none flex-col gap-0 p-0 md:flex md:flex-row md:items-stretch",
            open ? "flex" : "hidden"
          )}
        >
          {items.map((item) => {
            const to = item.href ?? routes[item.route];
            const active = isActive(to);
            return (
              <li key={item.code ?? item.labelKey} className="m-0 p-0">
                <LandingLink
                  to={to}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "relative flex min-h-[48px] items-center px-4 text-sm font-semibold uppercase tracking-wide no-underline",
                    // ! beats legacy overrides.css a:not(...):not(...) color rule
                    "!text-[hsl(var(--pgrl-on-primary))] motion-safe:transition-colors",
                    "hover:bg-[hsl(var(--pgrl-deep))]",
                    FOCUS_RING_DARK,
                    active &&
                      "bg-[hsl(var(--pgrl-deep))] " +
                        "max-md:border-0 max-md:border-l-4 max-md:border-solid max-md:border-l-[hsl(var(--pgrl-accent))] " +
                        "md:after:absolute md:after:inset-x-3 md:after:bottom-0 md:after:h-1 md:after:rounded-t-full md:after:bg-[hsl(var(--pgrl-accent))] md:after:content-['']"
                  )}
                >
                  {c(item.labelKey)}
                </LandingLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
