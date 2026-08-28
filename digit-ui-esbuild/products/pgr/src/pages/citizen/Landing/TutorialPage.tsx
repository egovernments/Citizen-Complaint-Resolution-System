// Standalone, shell-free in-app Tutorial page. Mounted by core App.js at
// /${contextPath}/tutorial and linked from the landing header's NAV_TRAINING
// item (route TRAINING). Reuses the exact same UtilityBar / LandingHeader /
// LandingFooter as the main landing page (not a page-specific chrome) so the
// site reads as one portal — see LandingRenderer for the reference assembly.
//
// Sidebar items each preview a Google Drive file (video / PDF) via Drive's
// embeddable "/preview" iframe endpoint — same disabled-placeholder
// convention as the rest of routes.ts: "#" renders a "content coming soon"
// panel instead of a broken embed.
import * as React from "react";
import { cn } from "@egovernments/digit-ui-components-v2";
import { buildTokenStyle, CONTAINER, FOCUS_RING } from "./tokens";
import { useLandingCopy } from "./useLandingCopy";
import { UtilityBar, DEFAULT_LANGUAGES } from "./components/UtilityBar";
import { LandingHeader } from "./components/LandingHeader";
import { LandingFooter } from "./components/LandingFooter";
import { DEFAULT_LANDING_ROUTES, LandingRoutes } from "./routes";
import type { LandingCopyKey } from "./content";

const EMBLEM_URL = "/digit-ui/emblem.png";

export interface TutorialPageProps {
  routes?: Partial<LandingRoutes>;
}

interface TutorialItem {
  labelKey: LandingCopyKey;
  routeKey: keyof LandingRoutes;
}

const ITEMS: TutorialItem[] = [
  { labelKey: "TUTORIAL_VIDEO_LABEL", routeKey: "TUTORIAL_VIDEO" },
  { labelKey: "TUTORIAL_MANUAL_LABEL", routeKey: "TUTORIAL_MANUAL" },
];

export function PGRTutorialPage({ routes: routeOverrides }: TutorialPageProps) {
  const { c, i18n } = useLandingCopy();
  const ctx = (typeof window !== "undefined" && (window as any)?.contextPath) || "digit-ui";
  const [active, setActive] = React.useState(0);

  // Same absolute, contextPath-prefixed in-app destinations AppEntry builds
  // for the main landing page — this page has no basename-relative router
  // context of its own, so it must compute them the same way.
  const routes: LandingRoutes = React.useMemo(
    () => ({
      ...DEFAULT_LANDING_ROUTES,
      HOME: `/${ctx}/landing`,
      REGISTER_COMPLAINT: `/${ctx}/citizen/pgr/create-complaint`,
      TRACK_COMPLAINT: `/${ctx}/citizen/pgr/complaints`,
      CITIZEN_LOGIN: `/${ctx}/citizen/login`,
      EMPLOYEE_LOGIN: `/${ctx}/employee`,
      PRIVACY: `/${ctx}/privacy-policy`,
      TRAINING: `/${ctx}/tutorial`,
      ...routeOverrides,
    }),
    [ctx, routeOverrides]
  );

  // Same LocalizationService-aware language switch as index.tsx's
  // ConfiguredLanding — this page has no <PGRLandingPage> parent to inherit it
  // from.
  const onLanguageChange = React.useCallback(
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
      i18n?.changeLanguage?.(code);
    },
    [i18n]
  );

  // Portuguese-first public page — same pattern as PrivacyPolicyPage.
  React.useEffect(() => {
    const activeLocale = String(i18n?.language || "").toLowerCase();
    if (!activeLocale.startsWith("pt")) onLanguageChange("pt_PT");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Configurator-editable tab title (PGR_LANDING_TAB_TITLE) — same as
  // LandingRenderer; this page has no <PGRLandingPage> parent to inherit it.
  React.useEffect(() => {
    if (typeof document !== "undefined") document.title = c("TAB_TITLE");
  }, [c]);

  const item = ITEMS[active];
  const src = routes[item.routeKey];
  const configured = !!src && src !== "#";

  return (
    <div className="v2-scope" style={buildTokenStyle()}>
      <div className="pgr-landing flex min-h-screen flex-col bg-[hsl(var(--pgrl-page))] text-[hsl(var(--pgrl-ink))]">
        <UtilityBar routes={routes} languages={DEFAULT_LANGUAGES} onLanguageChange={onLanguageChange} />
        <LandingHeader routes={routes} emblemUrl={EMBLEM_URL} />

        <main className={cn(CONTAINER, "flex-1 py-10")}>
          <h1 className="mb-6 text-2xl font-bold text-[hsl(var(--pgrl-ink))]">{c("TUTORIAL_PAGE_TITLE")}</h1>
          <div className="flex flex-col gap-6 md:flex-row">
            <nav aria-label={c("TUTORIAL_PAGE_TITLE")} className="w-full shrink-0 overflow-hidden rounded-[var(--pgrl-radius)] md:w-72">
              <ul className="m-0 flex list-none flex-col gap-0 p-0">
                {ITEMS.map((it, i) => {
                  const isActive = i === active;
                  return (
                    <li key={it.routeKey} className="m-0 p-0">
                      <button
                        type="button"
                        onClick={() => setActive(i)}
                        aria-current={isActive ? "true" : undefined}
                        className={cn(
                          "block w-full cursor-pointer border-0 px-4 py-3 text-left text-sm font-semibold motion-safe:transition-colors",
                          FOCUS_RING,
                          isActive
                            ? "bg-[hsl(var(--pgrl-primary))] !text-[hsl(var(--pgrl-on-primary))]"
                            : "bg-[hsl(var(--pgrl-deep))] !text-[hsl(var(--pgrl-on-primary)/0.85)] hover:bg-[hsl(var(--pgrl-deep)/0.85)]"
                        )}
                      >
                        {c(it.labelKey)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="flex-1 overflow-hidden rounded-[var(--pgrl-radius)] border border-solid border-[hsl(var(--pgrl-line))] bg-black">
              {configured ? (
                <iframe
                  key={item.routeKey}
                  src={src}
                  title={c(item.labelKey)}
                  className="h-[70vh] min-h-[480px] w-full"
                  allow="autoplay"
                  allowFullScreen
                />
              ) : (
                <div className="flex h-[70vh] min-h-[480px] w-full items-center justify-center bg-[hsl(var(--pgrl-surface))] p-6 text-center text-sm text-[hsl(var(--pgrl-ink-soft))]">
                  {c("TUTORIAL_PENDING")}
                </div>
              )}
            </div>
          </div>
        </main>

        <LandingFooter routes={routes} emblemUrl={EMBLEM_URL} />
      </div>
    </div>
  );
}

export default PGRTutorialPage;
