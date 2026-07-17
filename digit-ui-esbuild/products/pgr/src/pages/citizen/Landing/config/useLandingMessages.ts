// Live localization for the landing page (Builder text edits).
//
// The Builder saves text edits as PGR_LANDING_* messages in the localization
// service (module rainmaker-pgr) — but nothing on the public landing route
// loads that module into i18next, so `t()` always missed and useLandingCopy
// fell through to the built-in copy deck: saved edits never reflected on the
// live page. This hook is the missing link. It fetches the module bundle for
// the active locale (anonymously — this is a pre-login page, same exposure as
// the MDMS config fetch) and injects it with addResources, then re-renders.
//
// Deliberately uncached: the whole point is that a Builder save shows up on
// the next reload. One small POST per page load / locale switch.

import * as React from "react";

declare const Digit: any;

const LOC_MODULE = "rainmaker-pgr";
const SEARCH_PATH = "/localization/messages/v1/_search";

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Loads the rainmaker-pgr localization bundle for the active i18n language
 * into the i18n store. Returns a version counter that bumps when new messages
 * land, so the caller re-renders and `t()` resolves the fresh text.
 * Fail-open: on any error the page keeps rendering the built-in copy deck.
 */
export function useLandingMessages(i18n: any): number {
  const [version, setVersion] = React.useState(0);
  const locale: string = String(i18n?.language || "");
  const stateId: string | undefined = safe(() => Digit.ULBService.getStateId());

  React.useEffect(() => {
    if (!locale || !stateId) return undefined;
    let cancelled = false;
    const params = new URLSearchParams({ tenantId: stateId, module: LOC_MODULE, locale });
    fetch(`${SEARCH_PATH}?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RequestInfo: { apiId: "pgr-landing", ver: "1.0" } }),
    })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((data) => {
        const rows: Array<{ code?: string; message?: string }> = data?.messages || [];
        if (cancelled || !rows.length) return;
        const res: Record<string, string> = {};
        rows.forEach((m) => {
          if (m?.code && typeof m.message === "string") res[m.code] = m.message;
        });
        try {
          // Both namespace spellings used across the app (same as the
          // Builder's preview bridge).
          i18n?.addResources?.(locale, "translations", res);
          i18n?.addResources?.(locale, "translation", res);
        } catch {
          /* ignore — deck fallback still renders */
        }
        setVersion((v) => v + 1);
      })
      .catch(() => {
        /* public page — network/API failure just means deck fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [locale, stateId, i18n]);

  return version;
}
