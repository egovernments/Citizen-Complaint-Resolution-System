// Hero.
//
// Deliberate departures from the audited prototype:
//   - The single conflated CTA ("Submit or Track") is split into the two real
//     jobs-to-be-done: submit (yellow, primary) and track (inverse outline).
//   - The auto-rotating photo carousel is dropped (unlabeled controls, motion
//     without user intent, LCP weight). Default background is a deep-green
//     gradient with a subtle dot grid; deployments can layer a photo via
//     `imageUrl` — it renders under a fixed green scrim so text contrast is
//     guaranteed regardless of the photo.
//   - Trust markers (confidential, unique case number, notifications) move
//     above the fold; secondary channels shrink to compact chips.

import * as React from "react";
import { Send, Search, Lock, Hash, Bell, Smartphone, MessageCircle, Phone } from "lucide-react";
import { cn } from "@egovernments/digit-ui-components-v2";
import { CtaLink } from "./CtaLink";
import { useLandingCopy } from "../useLandingCopy";
import { LandingRoutes } from "../routes";
import { CONTAINER, FOCUS_RING_DARK } from "../tokens";

export interface HeroSectionProps {
  routes: LandingRoutes;
  /** Optional photographic background, rendered under the brand scrim. */
  imageUrl?: string;
}

export function HeroSection({ routes, imageUrl }: HeroSectionProps) {
  const { c } = useLandingCopy();

  const trust = [
    { icon: Lock, label: c("HERO_TRUST_CONFIDENTIAL") },
    { icon: Hash, label: c("HERO_TRUST_CASE_NUMBER") },
    { icon: Bell, label: c("HERO_TRUST_NOTIFICATIONS") },
  ];

  const chips = [
    { icon: Smartphone, label: c("HERO_CHANNEL_APP"), to: routes.ANDROID_APP, external: true },
    { icon: MessageCircle, label: c("HERO_CHANNEL_WA"), to: routes.WHATSAPP, external: true },
    { icon: Phone, label: c("HERO_CHANNEL_LINE"), to: routes.GREEN_LINE, external: false },
  ];

  return (
    <section
      aria-labelledby="pgr-landing-hero-title"
      className="relative isolate overflow-hidden bg-[linear-gradient(150deg,hsl(var(--pgrl-deep)),hsl(var(--pgrl-primary)))]"
    >
      {imageUrl && (
        <>
          <img src={imageUrl} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-[hsl(var(--pgrl-deep)/0.85)]" />
        </>
      )}
      {/* Decorative dot grid */}
      <svg
        aria-hidden
        className="absolute -right-10 -top-10 -z-10 h-[420px] w-[420px] text-[hsl(var(--pgrl-on-primary)/0.08)]"
        viewBox="0 0 200 200"
        fill="currentColor"
      >
        <defs>
          <pattern id="pgrl-dots" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="2" />
          </pattern>
        </defs>
        <rect width="200" height="200" fill="url(#pgrl-dots)" />
      </svg>

      <div className={cn(CONTAINER, "py-14 md:py-20")}>
        <div className="max-w-3xl">
          <p className="m-0 inline-flex items-center rounded-full bg-[hsl(var(--pgrl-on-primary)/0.12)] px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--pgrl-accent))]">
            {c("HERO_EYEBROW")}
          </p>

          <h1
            id="pgr-landing-hero-title"
            className="mb-0 mt-4 text-3xl font-bold leading-tight text-[hsl(var(--pgrl-on-primary))] sm:text-4xl lg:text-5xl"
          >
            {c("HERO_TITLE")}
          </h1>

          {/* Solid white: /0.9 dims below 4.5:1 over the gradient's light end. */}
          <p className="mb-0 mt-4 max-w-2xl text-base leading-relaxed text-[hsl(var(--pgrl-on-primary))] sm:text-lg">
            {c("HERO_LEDE")}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <CtaLink
              to={routes.REGISTER_COMPLAINT}
              variant="accent"
              size="lg"
              leading={<Send aria-hidden className="h-5 w-5" />}
              className="w-full sm:w-auto"
            >
              {c("HERO_CTA_SUBMIT")}
            </CtaLink>
            <CtaLink
              to={routes.TRACK_COMPLAINT}
              variant="inverse"
              size="lg"
              leading={<Search aria-hidden className="h-5 w-5" />}
              className="w-full sm:w-auto"
            >
              {c("HERO_CTA_TRACK")}
            </CtaLink>
          </div>

          {/* Trust markers */}
          <ul className="m-0 mt-8 flex list-none flex-wrap gap-x-6 gap-y-2 p-0">
            {trust.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="m-0 flex items-center gap-2 p-0 text-sm text-[hsl(var(--pgrl-on-primary))]"
              >
                <Icon aria-hidden className="h-4 w-4 text-[hsl(var(--pgrl-accent))]" />
                {label}
              </li>
            ))}
          </ul>

          {/* Secondary channels */}
          <div className="mt-8 border-0 border-t border-solid border-[hsl(var(--pgrl-on-primary)/0.15)] pt-5">
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--pgrl-on-primary))]">
              {c("HERO_CHANNELS_LABEL")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.map(({ icon: Icon, label, to, external }) => (
                <CtaLink
                  key={label}
                  to={to}
                  target={external && to !== "#" ? "_blank" : undefined}
                  variant="inverse"
                  className={
                    "min-h-[40px] rounded-full border-[hsl(var(--pgrl-on-primary)/0.65)] px-4 text-sm font-medium normal-case " +
                    FOCUS_RING_DARK
                  }
                  leading={<Icon aria-hidden className="h-4 w-4" />}
                >
                  {label}
                </CtaLink>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
