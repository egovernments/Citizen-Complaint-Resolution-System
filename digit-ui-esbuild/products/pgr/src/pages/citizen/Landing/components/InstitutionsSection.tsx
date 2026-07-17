// "IGE e IGSAE ao serviço do cidadão" — institutional legitimacy block.

import * as React from "react";
import { Section } from "./Section";
import { INSTITUTIONS } from "../content";
import { useLandingCopy } from "../useLandingCopy";
import type { LandingSectionConfig } from "../config/types";

export interface InstitutionsSectionProps {
  /** Config-driven overrides; absent => the built-in deck (unchanged). */
  section?: LandingSectionConfig;
}

export function InstitutionsSection({ section }: InstitutionsSectionProps = {}) {
  const { c } = useLandingCopy();
  const items: any[] = (section?.items as any[]) ?? INSTITUTIONS;

  return (
    <Section id="pgr-landing-institutions" title={c(section?.titleKey, "INST_TITLE")} tone="surface">
      <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2">
        {items.map((inst) => {
          const Icon = inst.icon;
          return (
            <li key={inst.id ?? inst.titleKey} className="m-0 p-0">
              <article className="flex h-full flex-col gap-4 rounded-[var(--pgrl-radius)] border border-solid border-[hsl(var(--pgrl-line))] bg-[hsl(var(--pgrl-page))] p-6 sm:flex-row sm:items-start">
                <span
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--pgrl-radius)] bg-[hsl(var(--pgrl-primary)/0.1)] text-[hsl(var(--pgrl-primary))]"
                >
                  <Icon className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="m-0 text-lg font-bold leading-snug text-[hsl(var(--pgrl-deep))]">{c(inst.titleKey)}</h3>
                  <p className="mb-0 mt-2 text-sm leading-relaxed text-[hsl(var(--pgrl-ink-soft))]">{c(inst.descKey)}</p>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
