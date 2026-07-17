// Confidentiality / data-protection assurance — the page's key trust block,
// now with a route into the actual privacy policy (missing in the prototype).

import * as React from "react";
import { Lock, ChevronRight } from "lucide-react";
import { Section } from "./Section";
import { CtaLink } from "./CtaLink";
import { useLandingCopy } from "../useLandingCopy";
import { LandingRoutes } from "../routes";
import type { LandingSectionConfig } from "../config/types";

export interface PrivacySectionProps {
  routes: LandingRoutes;
  /** Config-driven overrides; absent => the built-in deck (unchanged). */
  section?: LandingSectionConfig;
}

export function PrivacySection({ routes, section }: PrivacySectionProps) {
  const { c } = useLandingCopy();

  return (
    <Section id="pgr-landing-privacy" title={c(section?.titleKey, "PRIVACY_TITLE")} tone="surface">
      <div className="flex flex-col gap-6 rounded-[var(--pgrl-radius)] border border-solid border-[hsl(var(--pgrl-line))] border-l-4 border-l-[hsl(var(--pgrl-primary))] bg-[hsl(var(--pgrl-page))] p-6 sm:flex-row sm:items-start md:p-8">
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--pgrl-radius)] bg-[hsl(var(--pgrl-primary)/0.1)] text-[hsl(var(--pgrl-primary))]"
        >
          <Lock className="h-7 w-7" />
        </span>
        <div className="max-w-3xl">
          <p className="m-0 text-base font-semibold leading-relaxed text-[hsl(var(--pgrl-ink))]">{c(section?.bodyKey, "PRIVACY_P1")}</p>
          <p className="mb-0 mt-3 text-sm leading-relaxed text-[hsl(var(--pgrl-ink-soft))]">{c(section?.subtitleKey, "PRIVACY_P2")}</p>
          <CtaLink
            to={routes.PRIVACY}
            variant="subtle"
            className="mt-4 text-sm font-semibold"
            trailing={<ChevronRight aria-hidden className="h-4 w-4" />}
          >
            {c("PRIVACY_LINK")}
          </CtaLink>
        </div>
      </div>
    </Section>
  );
}
