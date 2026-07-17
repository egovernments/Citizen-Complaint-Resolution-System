// "Como Funciona" — the six-step case lifecycle.
//
// Semantically an ordered list (the prototype used unordered articles). The
// three loose trailing paragraphs from the prototype are consolidated into a
// single "guaranteed follow-up" callout so the reassurances read as one unit.

import * as React from "react";
import { Bell, Check } from "lucide-react";
import { Section } from "./Section";
import { HOW_STEPS } from "../content";
import { useLandingCopy } from "../useLandingCopy";
import type { LandingSectionConfig } from "../config/types";

export interface HowItWorksSectionProps {
  /** Config-driven overrides; absent => the built-in deck (unchanged). */
  section?: LandingSectionConfig;
}

export function HowItWorksSection({ section }: HowItWorksSectionProps = {}) {
  const { c } = useLandingCopy();
  const items: any[] = (section?.items as any[]) ?? HOW_STEPS;

  const notes = [c("HOW_NOTE_NOTIFY"), c("HOW_NOTE_RECORD"), c("HOW_NOTE_CHANNELS")];

  return (
    <Section id="pgr-landing-how" title={c(section?.titleKey, "HOW_TITLE")} tone="surface">
      <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((step, i) => {
          const Icon = step.icon;
          return (
            <li
              key={step.id ?? step.titleKey ?? i}
              className="m-0 flex items-start gap-4 rounded-[var(--pgrl-radius)] border border-solid border-[hsl(var(--pgrl-line))] bg-[hsl(var(--pgrl-page))] p-5"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--pgrl-primary))] text-base font-bold text-[hsl(var(--pgrl-on-primary))]"
              >
                {i + 1}
              </span>
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--pgrl-ink-soft))]">
                  <Icon aria-hidden className="h-4 w-4 text-[hsl(var(--pgrl-primary))]" />
                  {c("HOW_STEP_LABEL")} {i + 1}
                </span>
                <span className="text-base font-semibold leading-snug text-[hsl(var(--pgrl-ink))]">
                  {c(step.titleKey)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {/* Consolidated follow-up callout */}
      <aside
        aria-label={c("HOW_NOTE_TITLE")}
        className="mt-8 rounded-[var(--pgrl-radius)] border border-solid border-[hsl(var(--pgrl-line))] border-l-4 border-l-[hsl(var(--pgrl-accent))] bg-[hsl(var(--pgrl-accent)/0.07)] p-5"
      >
        <p className="m-0 flex items-center gap-2 text-base font-bold text-[hsl(var(--pgrl-deep))]">
          <Bell aria-hidden className="h-5 w-5 shrink-0 text-[hsl(var(--pgrl-deep))]" />
          {c("HOW_NOTE_TITLE")}
        </p>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {notes.map((note) => (
            <li key={note} className="m-0 flex items-start gap-2 p-0 text-sm leading-relaxed text-[hsl(var(--pgrl-ink))]">
              <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--pgrl-primary))]" />
              {note}
            </li>
          ))}
        </ul>
      </aside>
    </Section>
  );
}
