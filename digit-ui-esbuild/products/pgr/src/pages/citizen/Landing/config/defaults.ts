// Built-in fallback config for the config-driven landing (P1, CCSD-2006).
//
// Deliberately STRUCTURE-ONLY: it declares which sections exist, their order,
// and the page-level toggles — but carries NO content (no titleKey/items). Each
// section component supplies its own content defaults (section?.x ?? LITERAL,
// section?.items ?? DECK_ARRAY), so rendering from this fallback is byte-
// identical to the pre-P1 hardcoded page. useLandingConfig returns this when
// MDMS is missing, empty, disabled, or errors — the backward-compat guarantee.
//
// Order values mirror the Phase 0 seed (RAINMAKER-PGR.LandingSection):
// navigation 10, hero 30, types 40, steps 50, channels 60, privacy 70,
// news 80, institutions 90, cta 100, footer 110.

import type { LandingSectionConfig, ResolvedLandingConfig } from "./types";

const row = (code: string, type: string, order: number): LandingSectionConfig => ({
  code,
  type,
  order,
  enabled: true,
  status: "PUBLISHED",
});

export const DEFAULT_LANDING_SECTIONS: LandingSectionConfig[] = [
  row("navigation", "navigation", 10),
  row("hero", "hero", 30),
  row("types", "types", 40),
  row("steps", "steps", 50),
  row("channels", "channels", 60),
  row("privacy", "privacy", 70),
  row("news", "news", 80),
  row("institutions", "institutions", 90),
  row("cta", "cta", 100),
  row("footer", "footer", 110),
];

export const DEFAULT_LANDING_CONFIG: ResolvedLandingConfig = {
  page: {
    code: "default",
    enabled: true,
    showUtilityBar: true,
    showWhatsAppFab: true,
  },
  sections: DEFAULT_LANDING_SECTIONS,
};
