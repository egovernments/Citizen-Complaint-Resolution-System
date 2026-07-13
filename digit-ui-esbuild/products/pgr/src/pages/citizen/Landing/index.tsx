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

import { LandingRoutes } from "./routes";
import { LandingTokens } from "./tokens";
import { NewsItem } from "./content";
import { LanguageOption } from "./components/UtilityBar";
import { useLandingCopy } from "./useLandingCopy";
import { useLandingConfig } from "./config/useLandingConfig";
import { usePreviewBridge, PreviewBridge } from "./config/usePreviewBridge";
import { LandingRenderer } from "./LandingRenderer";

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
  /** Force the floating WhatsApp action on/off (else the LandingPageConfig
   *  toggle governs; default on). */
  showWhatsAppFab?: boolean;
  /** Force the top utility bar on/off (else the LandingPageConfig toggle
   *  governs; default on). */
  showUtilityBar?: boolean;
  className?: string;
}

/**
 * Config-driven entry point. Fetches the landing config from MDMS
 * (RAINMAKER-PGR.LandingSection + LandingPageConfig) with a built-in fallback
 * that reproduces the previous static layout, then renders it generically via
 * LandingRenderer. Props remain as integrator overrides layered on top of the
 * config. Backward-compatible: with no/empty config the page is unchanged.
 *
 * Preview mode (P4 Builder): when embedded with ?builderPreview=1 the config
 * comes from the Configurator via postMessage instead of MDMS. The branch
 * happens HERE, at the entry — LandingRenderer is Builder-unaware and always
 * receives a plain config, from either source.
 */
export function PGRLandingPage(props: PGRLandingPageProps) {
  const bridge = usePreviewBridge();
  // `bridge.active` is constant for the page's lifetime (URL + embedding), so
  // choosing between the two child components never reorders hooks.
  if (bridge.active) return <PreviewedLanding bridge={bridge} {...props} />;
  return <ConfiguredLanding {...props} />;
}

function ConfiguredLanding(props: PGRLandingPageProps) {
  const config = useLandingConfig();
  const { i18n } = useLandingCopy();

  // Language switching must go through the platform's localization service:
  // it FETCHES the target locale's message bundles (LocalizationService
  // .changeLanguage -> getLocale -> addResources) and records the choice in
  // Digit's store before switching i18next. A bare i18n.changeLanguage()
  // switches to a locale with no resources loaded and the page stays put —
  // which is exactly the EN/PT-toggle-does-nothing bug this fixes.
  const defaultLanguageChange = React.useCallback(
    (code: string) => {
      try {
        const D = typeof window !== "undefined" ? (window as unknown as { Digit?: any }).Digit : undefined;
        const stateCode = D?.ULBService?.getStateId?.();
        if (D?.LocalizationService?.changeLanguage) {
          D.LocalizationService.changeLanguage(code, stateCode);
          return;
        }
      } catch {
        /* fall through to the standalone path */
      }
      // No DIGIT shell (standalone embed): deck strings still switch.
      i18n?.changeLanguage?.(code);
    },
    [i18n]
  );

  return (
    <LandingRenderer
      config={config}
      {...props}
      onLanguageChange={props.onLanguageChange ?? defaultLanguageChange}
    />
  );
}

function PreviewedLanding({ bridge, ...props }: PGRLandingPageProps & { bridge: PreviewBridge }) {
  // Render nothing until the Builder pushes the first draft config.
  if (!bridge.config) return null;
  return <LandingRenderer config={bridge.config} {...props} />;
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
