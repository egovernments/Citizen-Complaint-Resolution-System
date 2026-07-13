// i18n resolution hook for the landing page.
//
// Same convention as CreatePGRFlowV2's `tr()` helper: react-i18next echoes the
// key back when a translation is missing, so we detect that and fall back to
// the built-in copy deck — picking PT or EN from the active i18n language
// (this deployment's default locale is pt_PT). Seeding `PGR_LANDING_*` keys in
// MDMS localization overrides any built-in string without a code change.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { LANDING_COPY, LandingCopyKey } from "./content";

export const LANDING_KEY_PREFIX = "PGR_LANDING_";

export interface LandingCopyApi {
  /** Resolve a landing copy key to display text. */
  c: (key: LandingCopyKey) => string;
  /** "pt" | "en" — resolved from the active i18n language. */
  lang: "pt" | "en";
  /** Raw i18n handle for integrators (language switching etc.). */
  i18n: ReturnType<typeof useTranslation>["i18n"];
}

export function useLandingCopy(): LandingCopyApi {
  const { t, i18n } = useTranslation();
  const lang: "pt" | "en" = String(i18n?.language || "pt")
    .toLowerCase()
    .startsWith("en")
    ? "en"
    : "pt";

  const c = React.useCallback(
    (key: LandingCopyKey): string => {
      const fullKey = LANDING_KEY_PREFIX + key;
      const translated = t(fullKey);
      if (translated && translated !== fullKey) return translated;
      return LANDING_COPY[key]?.[lang] ?? key;
    },
    [t, lang]
  );

  return { c, lang, i18n };
}
