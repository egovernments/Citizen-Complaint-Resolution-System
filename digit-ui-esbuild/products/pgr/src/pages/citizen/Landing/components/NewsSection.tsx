// "Últimas Actualizações" — news/updates grid.
//
// Audit fixes: excerpts are clamped (the prototype dumped full article bodies
// into cards), "Ler mais" is a real link (was a <button>), dates use <time>,
// and missing images degrade to a branded placeholder instead of a grey box.

import * as React from "react";
import { Newspaper, ArrowRight, ExternalLink } from "lucide-react";
import { Section } from "./Section";
import { LandingLink } from "./LandingLink";
import { CtaLink } from "./CtaLink";
import { NewsItem } from "../content";
import { useLandingCopy } from "../useLandingCopy";
import { LandingRoutes } from "../routes";
import { FOCUS_RING } from "../tokens";
import type { LandingSectionConfig } from "../config/types";

export interface NewsSectionProps {
  routes: LandingRoutes;
  items: NewsItem[];
  /** Config-driven overrides; absent => the built-in deck (unchanged).
   *  Note: news CARDS stay prop-driven (their raw CMS fields don't fit the
   *  key-based item schema) — only the heading is config-driven in v1. */
  section?: LandingSectionConfig;
}

const isExternal = (href: string) => /^https?:\/\//i.test(href);

export function NewsSection({ routes, items, section }: NewsSectionProps) {
  const { c } = useLandingCopy();
  if (!items || !items.length) return null;

  return (
    <Section
      id="pgr-landing-news"
      title={c(section?.titleKey, "NEWS_TITLE")}
      tone="page"
      action={
        <CtaLink
          to={routes.NEWS}
          variant="subtle"
          className="text-sm font-semibold"
          trailing={<ArrowRight aria-hidden className="h-4 w-4" />}
        >
          {c("NEWS_VIEW_ALL")}
        </CtaLink>
      }
    >
      <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const external = isExternal(item.href);
          return (
            <li key={item.id} className="m-0 p-0">
              <article className="group relative flex h-full flex-col overflow-hidden rounded-[var(--pgrl-radius)] border border-solid border-[hsl(var(--pgrl-line))] bg-[hsl(var(--pgrl-surface))] shadow-sm motion-safe:transition-shadow hover:shadow-md">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" loading="lazy" className="h-40 w-full object-cover" />
                ) : (
                  <div
                    aria-hidden
                    className="flex h-40 w-full items-center justify-center bg-[linear-gradient(150deg,hsl(var(--pgrl-deep)),hsl(var(--pgrl-primary)))]"
                  >
                    <Newspaper className="h-10 w-10 text-[hsl(var(--pgrl-on-primary)/0.5)]" />
                  </div>
                )}

                <div className="flex flex-1 flex-col p-5">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--pgrl-ink-soft))]">
                    <time dateTime={item.dateTime}>{item.dateLabel}</time>
                    <span aria-hidden>·</span>
                    {/* Deep text: primary on its own 10% tint is 4.37:1 — just under AA. */}
                    <span className="rounded-full bg-[hsl(var(--pgrl-primary)/0.1)] px-2 py-0.5 font-semibold text-[hsl(var(--pgrl-deep))]">
                      {item.tag}
                    </span>
                  </p>

                  <h3 className="mb-0 mt-3 text-base font-bold leading-snug text-[hsl(var(--pgrl-ink))]">
                    <LandingLink
                      to={item.href}
                      target={external ? "_blank" : undefined}
                      className={
                        "line-clamp-3 !text-inherit no-underline after:absolute after:inset-0 after:content-[''] group-hover:underline " +
                        FOCUS_RING
                      }
                    >
                      {item.title}
                    </LandingLink>
                  </h3>

                  <p className="mb-0 mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-[hsl(var(--pgrl-ink-soft))]">
                    {item.excerpt}
                  </p>

                  <p className="m-0 mt-4 flex items-center justify-between gap-2 border-0 border-t border-solid border-[hsl(var(--pgrl-line))] pt-3 text-xs">
                    <span className="truncate text-[hsl(var(--pgrl-ink-soft))]">{item.source}</span>
                    <span
                      aria-hidden
                      className="inline-flex shrink-0 items-center gap-1 font-semibold text-[hsl(var(--pgrl-primary))]"
                    >
                      {c("NEWS_READ_MORE")}
                      {external ? <ExternalLink className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    </span>
                  </p>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
