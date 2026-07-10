// PGR public landing page — self-contained, plug-in entry point.
//
// Renders the complete public Home for the Complaints & Reports Portal and
// routes every CTA into the EXISTING application via the configurable route
// map (./routes.ts). It implements no internal pages, no auth, no APIs.
//
// Integration (see README.md in this folder for the full guide):
//
//   import PGRLandingPage from ".../pages/citizen/Landing";
//   <Route exact path={`${path}/landing`}>
//     <PGRLandingPage routes={{ TRAINING: "/citizen/pgr/help" }} />
//   </Route>
//
// Works with or without a react-router v5 <Router> above it; strings resolve
// from MDMS localization (PGR_LANDING_* keys) with built-in PT/EN fallbacks;
// colors resolve from --pgrl-*-brand CSS vars with Mozambique gov defaults.

import * as React from "react";
import { cn } from "@egovernments/digit-ui-components-v2";

import { LandingRoutes, mergeRoutes, DEFAULT_LANDING_ROUTES } from "./routes";
import { buildTokenStyle, LandingTokens, DEFAULT_LANDING_TOKENS } from "./tokens";
import { NewsItem, DEFAULT_NEWS } from "./content";
import { useLandingCopy } from "./useLandingCopy";

import { UtilityBar, LanguageOption, DEFAULT_LANGUAGES } from "./components/UtilityBar";
import { LandingHeader } from "./components/LandingHeader";
import { HeroSection } from "./components/HeroSection";
import { TypesSection } from "./components/TypesSection";
import { HowItWorksSection } from "./components/HowItWorksSection";
import { ChannelsSection } from "./components/ChannelsSection";
import { PrivacySection } from "./components/PrivacySection";
import { NewsSection } from "./components/NewsSection";
import { InstitutionsSection } from "./components/InstitutionsSection";
import { FinalCtaSection } from "./components/FinalCtaSection";
import { LandingFooter } from "./components/LandingFooter";
import { WhatsAppFab } from "./components/WhatsAppFab";
import { FOCUS_RING } from "./tokens";

export interface PGRLandingPageProps {
  /** Override any destination — see LandingRoutes for the full map. */
  routes?: Partial<LandingRoutes>;
  /** News/updates cards; defaults to the seeded portal announcements. */
  news?: NewsItem[];
  /** Optional hero photo (rendered under the brand scrim). */
  heroImageUrl?: string;
  /** Government emblem for the masthead. */
  emblemUrl?: string;
  /** Language switcher options. */
  languages?: LanguageOption[];
  /** Custom language-change handler (defaults to i18n.changeLanguage). */
  onLanguageChange?: (code: string) => void;
  /** Design-token overrides (HSL triples — see LandingTokens). */
  tokens?: Partial<LandingTokens>;
  /** Show the floating WhatsApp action. Default true. */
  showWhatsAppFab?: boolean;
  className?: string;
}

export function PGRLandingPage({
  routes: routeOverrides,
  news = DEFAULT_NEWS,
  heroImageUrl,
  emblemUrl,
  languages = DEFAULT_LANGUAGES,
  onLanguageChange,
  tokens,
  showWhatsAppFab = true,
  className,
}: PGRLandingPageProps) {
  const { c } = useLandingCopy();
  const routes = React.useMemo(() => mergeRoutes(routeOverrides), [routeOverrides]);
  const tokenStyle = React.useMemo(() => buildTokenStyle(tokens), [tokens]);

  // The sticky nav (48px) would otherwise fully obscure elements the browser
  // scrolls into view on keyboard focus / skip-link jumps (WCAG 2.2 SC 2.4.11).
  // scroll-padding must live on the scroll container (html), so set it for the
  // page's lifetime and restore on unmount.
  React.useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.scrollPaddingTop;
    el.style.scrollPaddingTop = "4rem";
    return () => {
      el.style.scrollPaddingTop = prev;
    };
  }, []);

  return (
    // Outer div carries .v2-scope (activates the scoped Tailwind layer) and
    // seeds the --pgrl-* design tokens; utilities apply to descendants only.
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

        <UtilityBar routes={routes} languages={languages} onLanguageChange={onLanguageChange} />
        <LandingHeader routes={routes} emblemUrl={emblemUrl} />

        <main id="pgr-landing-main" className="flex-1">
          <HeroSection routes={routes} imageUrl={heroImageUrl} />
          <TypesSection routes={routes} />
          <HowItWorksSection />
          <ChannelsSection routes={routes} />
          <PrivacySection routes={routes} />
          <NewsSection routes={routes} items={news} />
          <InstitutionsSection />
          <FinalCtaSection routes={routes} />
        </main>

        <LandingFooter routes={routes} />
        {showWhatsAppFab && <WhatsAppFab href={routes.WHATSAPP} />}
      </div>
    </div>
  );
}

export default PGRLandingPage;

// Re-exports so integrators can compose sections or extend configuration
// without deep imports.
export { DEFAULT_LANDING_ROUTES, mergeRoutes } from "./routes";
export type { LandingRoutes } from "./routes";
export { DEFAULT_LANDING_TOKENS } from "./tokens";
export type { LandingTokens } from "./tokens";
export { DEFAULT_NEWS, LANDING_COPY } from "./content";
export type { NewsItem, LandingCopyKey } from "./content";
export { DEFAULT_LANGUAGES } from "./components/UtilityBar";
export type { LanguageOption } from "./components/UtilityBar";
export { useLandingCopy, LANDING_KEY_PREFIX } from "./useLandingCopy";
