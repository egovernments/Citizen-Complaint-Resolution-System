// Government footer.
//
// Audit fix: the prototype footer only listed channels + copyright. A public
// grievance portal footer must also carry the trust/legal surface (privacy,
// terms, accessibility), help links, and both login entries — all routed
// through the configurable route map.

import * as React from "react";
import { cn } from "@egovernments/digit-ui-components-v2";
import { LandingLink } from "./LandingLink";
import { useLandingCopy } from "../useLandingCopy";
import { LandingCopyKey } from "../content";
import { LandingRoutes } from "../routes";
import { CONTAINER, FOCUS_RING_DARK } from "../tokens";

export interface LandingFooterProps {
  routes: LandingRoutes;
}

interface FooterGroup {
  titleKey: LandingCopyKey;
  links: Array<{ labelKey: LandingCopyKey; route: keyof LandingRoutes; external?: boolean }>;
}

const GROUPS: FooterGroup[] = [
  {
    titleKey: "FOOTER_CHANNELS",
    links: [
      { labelKey: "FOOTER_PORTAL_WEB", route: "HOME" },
      { labelKey: "FOOTER_ANDROID", route: "ANDROID_APP", external: true },
      { labelKey: "FOOTER_WHATSAPP", route: "WHATSAPP", external: true },
      { labelKey: "FOOTER_GREEN_LINE", route: "GREEN_LINE" },
    ],
  },
  {
    titleKey: "FOOTER_LINKS",
    links: [
      { labelKey: "NAV_SUBMIT", route: "REGISTER_COMPLAINT" },
      { labelKey: "NAV_TRACK", route: "TRACK_COMPLAINT" },
      { labelKey: "NAV_TRAINING", route: "TRAINING" },
      { labelKey: "FOOTER_FAQ", route: "FAQ" },
      { labelKey: "NAV_CONTACTS", route: "CONTACTS" },
      { labelKey: "NAV_ABOUT", route: "ABOUT" },
    ],
  },
  {
    titleKey: "FOOTER_ACCESS",
    links: [
      { labelKey: "FOOTER_CITIZEN_LOGIN", route: "CITIZEN_LOGIN" },
      { labelKey: "FOOTER_EMPLOYEE_LOGIN", route: "EMPLOYEE_LOGIN" },
    ],
  },
  {
    titleKey: "FOOTER_LEGAL",
    links: [
      { labelKey: "FOOTER_PRIVACY", route: "PRIVACY" },
      { labelKey: "FOOTER_TERMS", route: "TERMS" },
      { labelKey: "FOOTER_ACCESSIBILITY", route: "ACCESSIBILITY" },
    ],
  },
];

// !important text colors: see CtaLink.tsx — legacy anchor rule collision.
const FOOT_LINK = cn(
  "inline-flex min-h-[32px] items-center text-sm !text-[hsl(var(--pgrl-on-primary)/0.8)] no-underline",
  "hover:!text-[hsl(var(--pgrl-accent))] hover:underline motion-safe:transition-colors",
  FOCUS_RING_DARK
);

export function LandingFooter({ routes }: LandingFooterProps) {
  const { c } = useLandingCopy();
  const year = new Date().getFullYear();

  return (
    <footer className="bg-[hsl(var(--pgrl-deep))]">
      <div className={cn(CONTAINER, "grid grid-cols-1 gap-8 py-12 sm:grid-cols-2 lg:grid-cols-6")}>
        {/* Identity */}
        <div className="sm:col-span-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--pgrl-on-primary)/0.7)]">
            {c("GOV_NAME")}
          </p>
          <p className="mb-0 mt-1 text-lg font-bold leading-snug text-[hsl(var(--pgrl-on-primary))]">
            {c("PORTAL_NAME")}
          </p>
          <p className="mb-0 mt-2 text-sm text-[hsl(var(--pgrl-on-primary)/0.8)]">
            {c("ORG_NAMES")} · {c("TAGLINE")}
          </p>
          <p className="mb-0 mt-3 inline-block rounded-full bg-[hsl(var(--pgrl-accent)/0.15)] px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--pgrl-accent))]">
            {c("MOTTO_VALUES")}
          </p>
        </div>

        {GROUPS.map((group) => (
          <nav key={group.titleKey} aria-label={c(group.titleKey)}>
            <p className="m-0 text-sm font-bold uppercase tracking-wide text-[hsl(var(--pgrl-on-primary))]">
              {c(group.titleKey)}
            </p>
            <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
              {group.links.map((link) => {
                const to = routes[link.route];
                return (
                  <li key={link.labelKey} className="m-0 p-0">
                    <LandingLink
                      to={to}
                      target={link.external && to !== "#" ? "_blank" : undefined}
                      className={FOOT_LINK}
                    >
                      {c(link.labelKey)}
                    </LandingLink>
                  </li>
                );
              })}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-0 border-t border-solid border-[hsl(var(--pgrl-on-primary)/0.15)]">
        <div className={cn(CONTAINER, "py-4")}>
          <p className="m-0 text-center text-xs text-[hsl(var(--pgrl-on-primary)/0.7)]">
            © {year} {c("FOOTER_COPYRIGHT")}
          </p>
        </div>
      </div>
    </footer>
  );
}
