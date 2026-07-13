// Closing conversion band — last chance to act before the footer.

import * as React from "react";
import { Megaphone, Send, MessageCircle } from "lucide-react";
import { cn } from "@egovernments/digit-ui-components-v2";
import { CtaLink } from "./CtaLink";
import { useLandingCopy } from "../useLandingCopy";
import { LandingRoutes } from "../routes";
import { CONTAINER } from "../tokens";

export interface FinalCtaSectionProps {
  routes: LandingRoutes;
}

export function FinalCtaSection({ routes }: FinalCtaSectionProps) {
  const { c } = useLandingCopy();

  return (
    <section
      aria-labelledby="pgr-landing-final-title"
      className="bg-[linear-gradient(150deg,hsl(var(--pgrl-deep)),hsl(var(--pgrl-primary)))]"
    >
      <div className={cn(CONTAINER, "flex flex-col items-start gap-6 py-12 md:flex-row md:items-center md:justify-between md:py-14")}>
        <div className="max-w-2xl">
          {/* Deep circle: yellow icon on a yellow tint dips under 3:1 at the
              gradient's light end; accent-on-deep is 6.9:1 anywhere. */}
          <p className="m-0 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--pgrl-deep))]">
            <Megaphone aria-hidden className="h-6 w-6 text-[hsl(var(--pgrl-accent))]" />
          </p>
          <h2
            id="pgr-landing-final-title"
            className="mb-0 mt-4 text-2xl font-bold leading-tight text-[hsl(var(--pgrl-on-primary))] md:text-3xl"
          >
            {c("FINAL_TITLE")}
          </h2>
          <p className="mb-0 mt-3 text-base leading-relaxed text-[hsl(var(--pgrl-on-primary))]">
            {c("FINAL_TEXT")}
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row md:shrink-0">
          <CtaLink
            to={routes.REGISTER_COMPLAINT}
            variant="accent"
            size="lg"
            leading={<Send aria-hidden className="h-5 w-5" />}
            className="w-full sm:w-auto"
          >
            {c("FINAL_CTA")}
          </CtaLink>
          <CtaLink
            to={routes.WHATSAPP}
            target="_blank"
            variant="inverse"
            size="lg"
            leading={<MessageCircle aria-hidden className="h-5 w-5" />}
            className="w-full sm:w-auto"
          >
            {c("CHANNEL_WA_CTA")}
          </CtaLink>
        </div>
      </div>
    </section>
  );
}
