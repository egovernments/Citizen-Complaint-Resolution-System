// Slim government utility strip: state identity, green line, switchboard,
// language toggle and sign-in. Deep green (vs the prototype's light grey) so
// the state band anchors the page and the white masthead below reads as one
// header instead of three stacked bars.

import * as React from "react";
import { Phone, LogIn } from "lucide-react";
import { cn } from "@egovernments/digit-ui-components-v2";
import { LandingLink } from "./LandingLink";
import { useLandingCopy } from "../useLandingCopy";
import { LandingRoutes } from "../routes";
import { CONTAINER, FOCUS_RING_DARK } from "../tokens";

export interface LanguageOption {
  /** i18n locale code, e.g. "pt_PT". */
  code: string;
  /** Short visible label, e.g. "PT". */
  label: string;
}

export const DEFAULT_LANGUAGES: LanguageOption[] = [
  { code: "pt_PT", label: "PT" },
  { code: "en_IN", label: "EN" },
];

export interface UtilityBarProps {
  routes: LandingRoutes;
  languages: LanguageOption[];
  onLanguageChange?: (code: string) => void;
}

// !important text colors: legacy overrides.css `a:not(.digit-button):not(.button)`
// (0-2-1, plus a :hover variant at 0-3-1) outranks scoped utilities otherwise.
const UTIL_LINK =
  "inline-flex min-h-[36px] items-center gap-1.5 no-underline !text-[hsl(var(--pgrl-on-primary))] hover:!text-[hsl(var(--pgrl-accent))] motion-safe:transition-colors " +
  FOCUS_RING_DARK;

export function UtilityBar({ routes, languages, onLanguageChange }: UtilityBarProps) {
  const { c, i18n } = useLandingCopy();

  const activeLang = String(i18n?.language || "").toLowerCase();
  const isActive = (code: string) =>
    activeLang === code.toLowerCase() || activeLang.split(/[-_]/)[0] === code.toLowerCase().split(/[-_]/)[0];

  const changeLanguage = (code: string) => {
    if (onLanguageChange) onLanguageChange(code);
    else i18n?.changeLanguage?.(code);
  };

  return (
    // role=region: aria-label on a generic div is ignored by assistive tech
    <div role="region" aria-label={c("ARIA_UTILITY")} className="bg-[hsl(var(--pgrl-deep))] text-xs sm:text-sm">
      <div className={cn(CONTAINER, "flex min-h-[36px] items-center justify-between gap-3 py-1")}>
        <p className="m-0 hidden items-center gap-2 text-[hsl(var(--pgrl-on-primary)/0.85)] sm:flex">
          <span className="font-semibold uppercase tracking-wide">{c("GOV_NAME")}</span>
          <span aria-hidden className="text-[hsl(var(--pgrl-on-primary)/0.4)]">
            |
          </span>
          <a href={routes.GREEN_LINE} className={UTIL_LINK}>
            {c("UTILITY_GREEN_LINE")}
            <span className="text-[hsl(var(--pgrl-on-primary)/0.6)]">({c("UTILITY_GREEN_LINE_FREE")})</span>
          </a>
        </p>

        <div className="flex items-center gap-3 sm:gap-4">
          <a href={routes.PHONE} className={cn(UTIL_LINK, "hidden md:inline-flex")}>
            <Phone aria-hidden className="h-3.5 w-3.5" />
            {c("UTILITY_PHONE_LABEL")}
          </a>

          <div role="group" aria-label={c("ARIA_LANGUAGE")} className="flex items-center gap-1">
            {languages.map((lng, i) => (
              <React.Fragment key={lng.code}>
                {i > 0 && (
                  <span aria-hidden className="text-[hsl(var(--pgrl-on-primary)/0.4)]">
                    |
                  </span>
                )}
                <button
                  type="button"
                  aria-pressed={isActive(lng.code)}
                  onClick={() => changeLanguage(lng.code)}
                  className={cn(
                    "m-0 min-h-[36px] cursor-pointer border-0 bg-transparent px-1.5 font-semibold",
                    "motion-safe:transition-colors",
                    FOCUS_RING_DARK,
                    isActive(lng.code)
                      ? "text-[hsl(var(--pgrl-accent))] underline underline-offset-4"
                      : "text-[hsl(var(--pgrl-on-primary)/0.85)] no-underline hover:text-[hsl(var(--pgrl-on-primary))]"
                  )}
                >
                  {lng.label}
                </button>
              </React.Fragment>
            ))}
          </div>

          <LandingLink to={routes.CITIZEN_LOGIN} className={cn(UTIL_LINK, "font-semibold")}>
            <LogIn aria-hidden className="h-3.5 w-3.5" />
            {c("LOGIN")}
          </LandingLink>
        </div>
      </div>
    </div>
  );
}
