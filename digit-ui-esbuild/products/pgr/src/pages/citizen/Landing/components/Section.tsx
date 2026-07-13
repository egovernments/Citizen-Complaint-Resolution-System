// Section shell: consistent rhythm, landmark labelling and the signature
// heading treatment (bold green title over a yellow accent bar).
//
// Every landing section renders through this shell so vertical spacing,
// container width and heading hierarchy stay uniform — the biggest visual
// consistency problem in the audited prototype.

import * as React from "react";
import { cn } from "@egovernments/digit-ui-components-v2";
import { CONTAINER } from "../tokens";

export interface SectionProps {
  /** Stable id — becomes the aria-labelledby anchor (`${id}-title`). */
  id: string;
  title?: string;
  intro?: string;
  /** Optional element rendered to the right of the title (e.g. "view all"). */
  action?: React.ReactNode;
  /** page = transparent over the grey page bg; surface = white band. */
  tone?: "page" | "surface";
  className?: string;
  children: React.ReactNode;
}

export function Section({ id, title, intro, action, tone = "page", className, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={title ? `${id}-title` : undefined}
      className={cn(tone === "surface" && "bg-[hsl(var(--pgrl-surface))]", className)}
    >
      <div className={cn(CONTAINER, "py-12 md:py-16")}>
        {title && (
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-3xl">
              <h2
                id={`${id}-title`}
                className="m-0 text-2xl font-bold leading-tight text-[hsl(var(--pgrl-deep))] md:text-3xl"
              >
                {title}
              </h2>
              <div aria-hidden className="mt-3 h-1 w-12 rounded-full bg-[hsl(var(--pgrl-accent))]" />
              {intro && (
                <p className="mb-0 mt-4 max-w-2xl text-base leading-relaxed text-[hsl(var(--pgrl-ink-soft))]">
                  {intro}
                </p>
              )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
