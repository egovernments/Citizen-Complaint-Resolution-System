// "Tipos de Manifestação" — the four legal submission types.
//
// Audit fixes vs the prototype: the four cards were visually identical (and
// three of four translated to the same English word), so each type now gets a
// distinct icon + accent colour; the whole card is one clickable target via
// the stretched-link pattern (single tab stop, no repeated "Submit" buttons).

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Section } from "./Section";
import { LandingLink } from "./LandingLink";
import { MANIFESTATION_TYPES } from "../content";
import { useLandingCopy } from "../useLandingCopy";
import { LandingRoutes } from "../routes";
import { FOCUS_RING } from "../tokens";
import type { LandingSectionConfig } from "../config/types";

export interface TypesSectionProps {
  routes: LandingRoutes;
  /** Config-driven overrides; absent => the built-in deck (unchanged). */
  section?: LandingSectionConfig;
}

export function TypesSection({ routes, section }: TypesSectionProps) {
  const { c } = useLandingCopy();
  const items: any[] = (section?.items as any[]) ?? MANIFESTATION_TYPES;

  return (
    <Section
      id="pgr-landing-types"
      title={c(section?.titleKey, "TYPES_TITLE")}
      intro={c(section?.subtitleKey, "TYPES_INTRO")}
      tone="page"
    >
      <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((type) => {
          const Icon = type.icon;
          const accent = `hsl(var(${type.accentVar}))`;
          return (
            <li key={type.id} className="m-0 p-0">
              <article
                className="group relative flex h-full flex-col rounded-[var(--pgrl-radius)] border border-solid border-[hsl(var(--pgrl-line))] bg-[hsl(var(--pgrl-surface))] p-6 shadow-sm motion-safe:transition-shadow hover:shadow-md"
                style={{ borderTopWidth: 4, borderTopColor: accent }}
              >
                <span
                  aria-hidden
                  className="flex h-12 w-12 items-center justify-center rounded-[var(--pgrl-radius)]"
                  style={{ backgroundColor: `hsl(var(${type.accentVar})/0.12)`, color: accent }}
                >
                  <Icon className="h-6 w-6" />
                </span>

                <h3 className="mb-0 mt-4 text-lg font-bold text-[hsl(var(--pgrl-ink))]">
                  {/* Stretched link: one big click target, single tab stop. */}
                  <LandingLink
                    to={type.href ?? routes[type.route]}
                    className={
                      "!text-inherit no-underline after:absolute after:inset-0 after:content-[''] " +
                      "rounded-[var(--pgrl-radius)] " +
                      FOCUS_RING
                    }
                  >
                    {c(type.titleKey)}
                  </LandingLink>
                </h3>

                <p className="mb-0 mt-2 flex-1 text-sm leading-relaxed text-[hsl(var(--pgrl-ink-soft))]">
                  {c(type.descKey)}
                </p>

                <span
                  aria-hidden
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold group-hover:underline"
                  style={{ color: accent }}
                >
                  {c("TYPE_CTA")}
                  <ChevronRight className="h-4 w-4 motion-safe:transition-transform group-hover:translate-x-0.5" />
                </span>
              </article>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
