// "Canais de Atendimento" — every way to reach the service, in one place.
//
// Audit fix: the prototype scattered channels across three places (hero chips,
// a two-card section, and the footer-only Green Line 1490). This section is
// the single canonical inventory — including the toll-free line, which is the
// most inclusive channel and was the hardest to find.

import * as React from "react";
import { ExternalLink, ChevronRight } from "lucide-react";
import { Section } from "./Section";
import { CtaLink } from "./CtaLink";
import { CHANNELS } from "../content";
import { useLandingCopy } from "../useLandingCopy";
import { LandingRoutes } from "../routes";
import type { LandingSectionConfig } from "../config/types";

export interface ChannelsSectionProps {
  routes: LandingRoutes;
  /** Config-driven overrides; absent => the built-in deck (unchanged). */
  section?: LandingSectionConfig;
}

export function ChannelsSection({ routes, section }: ChannelsSectionProps) {
  const { c } = useLandingCopy();
  const items: any[] = (section?.items as any[]) ?? CHANNELS;

  return (
    <Section
      id="pgr-landing-channels"
      title={c(section?.titleKey, "CHANNELS_TITLE")}
      intro={c(section?.subtitleKey, "CHANNELS_INTRO")}
      tone="page"
    >
      <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((channel) => {
          const Icon = channel.icon;
          const to = channel.href ?? routes[channel.route];
          const external = Boolean(channel.external) && to !== "#";
          return (
            <li key={channel.id} className="m-0 p-0">
              <article className="flex h-full flex-col rounded-[var(--pgrl-radius)] border border-solid border-[hsl(var(--pgrl-line))] bg-[hsl(var(--pgrl-surface))] p-6 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span
                    aria-hidden
                    className="flex h-12 w-12 items-center justify-center rounded-[var(--pgrl-radius)] bg-[hsl(var(--pgrl-primary)/0.1)] text-[hsl(var(--pgrl-primary))]"
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  {channel.badgeKey && (
                    <span className="rounded-full bg-[hsl(var(--pgrl-accent)/0.2)] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--pgrl-deep))]">
                      {c(channel.badgeKey)}
                    </span>
                  )}
                </div>

                <h3 className="mb-0 mt-4 text-lg font-bold text-[hsl(var(--pgrl-ink))]">{c(channel.titleKey)}</h3>
                <p className="mb-0 mt-2 flex-1 text-sm leading-relaxed text-[hsl(var(--pgrl-ink-soft))]">
                  {c(channel.descKey)}
                </p>

                <CtaLink
                  to={to}
                  target={external ? "_blank" : undefined}
                  variant="outline"
                  className="mt-5 w-full text-sm"
                  trailing={
                    external ? (
                      <ExternalLink aria-hidden className="h-4 w-4" />
                    ) : (
                      <ChevronRight aria-hidden className="h-4 w-4" />
                    )
                  }
                >
                  {c(channel.ctaKey)}
                </CtaLink>
              </article>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
