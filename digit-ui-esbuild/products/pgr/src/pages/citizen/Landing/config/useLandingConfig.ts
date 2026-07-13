// Runtime config fetch for the landing page (P1, CCSD-2006).
//
// Reads RAINMAKER-PGR.LandingSection + LandingPageConfig from MDMS at the state
// tenant (where Phase 0 seeds them), with an optional city overlay (tenant
// override: city rows win by `code`). Everything degrades gracefully — while
// loading, on error, on empty data, or when the page is disabled, it returns
// the built-in DEFAULT_LANDING_CONFIG, which reproduces today's layout. So the
// page NEVER renders blank and is backward-compatible by construction.
//
// The fetch is anonymous/pre-login (this is a public page); MDMS _search is
// exposed publicly via Kong. useCustomMDMS (v1 _search branch) reads the
// v2-seeded rows — verified against the local stack.

import * as React from "react";
import { DEFAULT_LANDING_CONFIG, DEFAULT_LANDING_SECTIONS } from "./defaults";
import { mergeSectionsByCode, orderSections } from "./resolve";
import type {
  LandingPageConfig,
  LandingSectionConfig,
  ResolvedLandingConfig,
} from "./types";

// `Digit` is the app-global runtime (same access pattern as the rest of
// products/pgr). The landing only ever mounts inside the DIGIT shell, so it is
// always present; typed loose to avoid coupling to the libraries' d.ts.
declare const Digit: any;

interface LandingFetch {
  sections: LandingSectionConfig[];
  page?: LandingPageConfig;
}

const selectLanding = (raw: any): LandingFetch => ({
  sections: (raw?.["RAINMAKER-PGR"]?.LandingSection as LandingSectionConfig[]) || [],
  page: (raw?.["RAINMAKER-PGR"]?.LandingPageConfig as LandingPageConfig[])?.[0],
});

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export interface UseLandingConfigResult extends ResolvedLandingConfig {
  isLoading: boolean;
  /** true when the resolved config came from MDMS (vs the built-in fallback). */
  fromConfig: boolean;
}

export function useLandingConfig(): UseLandingConfigResult {
  const stateId: string | undefined = safe(() => Digit.ULBService.getStateId());
  const currentTenant: string | undefined =
    safe(() => Digit.ULBService.getCurrentTenantId()) || stateId;

  const userRoles: string[] =
    safe(() => (Digit.UserService.getUser()?.info?.roles || []).map((r: any) => r.code)) || [];

  const isAdmin = userRoles.includes("ADMIN") || userRoles.includes("SUPERUSER");
  const preview =
    isAdmin && typeof window !== "undefined" && /[?&]preview=1\b/.test(window.location.search || "");

  const commonOpts = { cacheTime: Infinity, staleTime: Infinity, select: selectLanding } as const;

  // State-tenant rows (where the config lives).
  const { data: stateData, isLoading } = Digit.Hooks.useCustomMDMS(
    stateId,
    "RAINMAKER-PGR",
    [{ name: "LandingSection" }, { name: "LandingPageConfig" }],
    { ...commonOpts, enabled: !!stateId }
  );

  // City overlay — only when a distinct city tenant is in context.
  const cityEnabled = !!currentTenant && currentTenant !== stateId;
  const { data: cityData } = Digit.Hooks.useCustomMDMS(
    currentTenant,
    "RAINMAKER-PGR",
    [{ name: "LandingSection" }, { name: "LandingPageConfig" }],
    { ...commonOpts, enabled: cityEnabled }
  );

  return React.useMemo<UseLandingConfigResult>(() => {
    const state: LandingFetch = stateData || { sections: [], page: undefined };
    const city: LandingFetch = cityData || { sections: [], page: undefined };

    const page: LandingPageConfig | undefined = city.page || state.page;
    const rawSections = mergeSectionsByCode(state.sections, city.sections);

    // Fall back to the built-in layout when MDMS is empty, the page is
    // explicitly disabled, or nothing survives filtering.
    const pageDisabled = page && page.enabled === false;
    if (pageDisabled || !rawSections || rawSections.length === 0) {
      return { ...DEFAULT_LANDING_CONFIG, isLoading: !!isLoading, fromConfig: false };
    }

    const ordered = orderSections(rawSections, page?.sectionOrder, userRoles, { preview });
    if (ordered.length === 0) {
      // Config present but nothing visible (e.g. all role-gated away) — keep the
      // structural default rather than a blank page.
      return {
        page: page || DEFAULT_LANDING_CONFIG.page,
        sections: DEFAULT_LANDING_SECTIONS,
        isLoading: !!isLoading,
        fromConfig: false,
      };
    }

    return {
      page: page || DEFAULT_LANDING_CONFIG.page,
      sections: ordered,
      isLoading: !!isLoading,
      fromConfig: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateData, cityData, isLoading, preview, userRoles.join(",")]);
}
