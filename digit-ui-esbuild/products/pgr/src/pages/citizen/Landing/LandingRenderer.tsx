// Generic, config-driven renderer for the PGR public landing (P1, CCSD-2006).
//
// It consumes a ResolvedLandingConfig (LandingPageConfig + ordered, filtered,
// role-gated LandingSection rows — see useLandingConfig) and assembles the page
// through the type->component registry. It reproduces the pre-P1 shell
// byte-for-byte: the .v2-scope token wrapper, the .pgr-landing column, the skip
// link, the scroll-padding effect, and the header/main/footer DOM slots. When
// the config is the built-in default (MDMS absent) every section falls back to
// its own content defaults, so the output is identical to the static page.
//
// Config is untrusted input: unknown section types have no registry entry and
// are skipped; page toggles gate the two chrome pieces; all links still flow
// through CtaLink/LandingLink so the overrides.css anchor !important defence is
// preserved.

import * as React from "react";
import { cn } from "@egovernments/digit-ui-components-v2";

import { LandingRoutes, mergeRoutes } from "./routes";
import { buildTokenStyle, LandingTokens, FOCUS_RING } from "./tokens";
import { NewsItem, DEFAULT_NEWS } from "./content";
import { useLandingCopy } from "./useLandingCopy";
import { UtilityBar, LanguageOption, DEFAULT_LANGUAGES } from "./components/UtilityBar";
import { WhatsAppFab } from "./components/WhatsAppFab";

import { getEntry, RenderCtx, Slot } from "./config/sectionRegistry";
import type { LandingSectionConfig, ResolvedLandingConfig } from "./config/types";

export interface LandingRendererProps {
  config: ResolvedLandingConfig;
  routes?: Partial<LandingRoutes>;
  news?: NewsItem[];
  heroImageUrl?: string;
  emblemUrl?: string;
  languages?: LanguageOption[];
  onLanguageChange?: (code: string) => void;
  tokens?: Partial<LandingTokens>;
  /** Explicit override; when undefined the LandingPageConfig toggle governs. */
  showWhatsAppFab?: boolean;
  showUtilityBar?: boolean;
  className?: string;
}

export function LandingRenderer({
  config,
  routes: routeOverrides,
  news = DEFAULT_NEWS,
  heroImageUrl,
  emblemUrl,
  languages = DEFAULT_LANGUAGES,
  onLanguageChange,
  tokens,
  showWhatsAppFab,
  showUtilityBar,
  className,
}: LandingRendererProps) {
  const { c } = useLandingCopy();
  const routes = React.useMemo(() => mergeRoutes(routeOverrides), [routeOverrides]);
  const tokenStyle = React.useMemo(() => buildTokenStyle(tokens), [tokens]);

  // Sticky nav (48px) vs keyboard-focus / skip-link jumps (WCAG 2.4.11); the
  // scroll container is <html>, so set for the page's lifetime and restore.
  React.useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.scrollPaddingTop;
    el.style.scrollPaddingTop = "4rem";
    return () => {
      el.style.scrollPaddingTop = prev;
    };
  }, []);

  const page = config.page || {};
  const utilityOn = showUtilityBar ?? page.showUtilityBar ?? true;
  const fabOn = showWhatsAppFab ?? page.showWhatsAppFab ?? true;

  const ctx: RenderCtx = React.useMemo(
    () => ({ routes, news, heroImageUrl, emblemUrl }),
    [routes, news, heroImageUrl, emblemUrl]
  );

  // Group the ordered, visible sections into DOM slots; unknown types (no
  // registry entry) are dropped here.
  const slots = React.useMemo(() => {
    const out: Record<Slot, LandingSectionConfig[]> = { header: [], main: [], footer: [] };
    (config.sections || []).forEach((s) => {
      const entry = getEntry(s.type);
      if (entry) out[entry.slot].push(s);
    });
    return out;
  }, [config.sections]);

  const renderSection = (s: LandingSectionConfig, i: number) => {
    const entry = getEntry(s.type);
    if (!entry) return null;
    const { Component, buildProps } = entry;
    return <Component key={s.code ?? `${s.type}-${i}`} {...buildProps(s, ctx)} />;
  };

  return (
    <div className="v2-scope" style={tokenStyle}>
      <div
        className={cn(
          "pgr-landing flex min-h-screen flex-col bg-[hsl(var(--pgrl-page))] text-[hsl(var(--pgrl-ink))]",
          className
        )}
      >
        <a
          href="#pgr-landing-main"
          className={cn(
            "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-[var(--pgrl-radius)]",
            "focus:bg-[hsl(var(--pgrl-surface))] focus:px-4 focus:py-2 focus:font-semibold focus:text-[hsl(var(--pgrl-deep))] focus:shadow-lg",
            FOCUS_RING
          )}
        >
          {c("SKIP_LINK")}
        </a>

        {utilityOn && (
          <UtilityBar routes={routes} languages={languages} onLanguageChange={onLanguageChange} />
        )}
        {slots.header.map(renderSection)}

        <main id="pgr-landing-main" className="flex-1">
          {slots.main.map(renderSection)}
        </main>

        {slots.footer.map(renderSection)}
        {fabOn && <WhatsAppFab href={routes.WHATSAPP} />}
      </div>
    </div>
  );
}

export default LandingRenderer;
