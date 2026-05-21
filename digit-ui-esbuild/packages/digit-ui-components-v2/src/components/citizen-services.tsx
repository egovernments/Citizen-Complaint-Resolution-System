/* eslint-disable @typescript-eslint/no-explicit-any */
// Citizen "All services" landing — v2 (Tailwind + shadcn-style chrome).
//
// Strangler-fig replacement for the legacy `CitizenHome` body in
// `packages/modules/core/src/components/Home.js`. The page consumes the
// same MDMS-driven shape (`getCitizenMenu`) the legacy CitizenHomeCard
// grid uses, so routing, link data, and the i18n keys carry over without
// any backend changes.
//
// Design decisions:
//   * Single full-width column inside the v2 sidebar layout — page header
//     ("All Services" / brand-tinted) + responsive grid of module cards.
//   * Each module card lists the module's available services as tappable
//     rows with chevron affordance. Hover uses the theme's
//     --color-primary-selected-bg (kenya-yellow #FFF4D7 on naipepea) so
//     the same hover language matches the v2 dropdown / sidebar rows.
//   * No back link at the top — the citizen sidebar's Home row already
//     covers that, and a top-of-page Back was redundant on this surface.
//   * No card outline shadows on hover; this surface is dense, the tint
//     alone is enough to read the affordance.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card } from "./ui/card";

interface ServiceLink {
  link?: string;
  navigationURL?: string;
  /** legacy field — display label as a translation key */
  i18nKey?: string;
  /** raw key, used as fallback if i18nKey is missing */
  name?: string;
  state?: any;
}

export interface CitizenServiceModule {
  links?: ServiceLink[];
  /** translation key for the module title (e.g. ACTION_TEST_PGR). */
  header?: string;
  /** legacy iconName — kept for API compat; v2 prefers the renderIcon prop. */
  iconName?: string;
}

export interface CitizenServicesProps {
  /**
   * Map of module-code -> processed link data, exactly the shape the
   * legacy `processLinkData` helper produces. Keys are module codes
   * (e.g. "PGR", "PT"); values carry the module's links + header.
   */
  modules: Record<string, CitizenServiceModule | null | undefined>;
  /**
   * Caller-owned per-module icon. The legacy code uses CustomSVG icons
   * keyed by module code (PT, WS, PGR, …); we keep that mapping in the
   * caller so v2 stays decoupled from the icon registry.
   */
  renderIcon?: (code: string) => React.ReactNode;
  /** Optional page-level title; falls back to the CS_HOME_HEADER key. */
  title?: React.ReactNode;
}

function ModuleCard({
  code,
  data,
  renderIcon,
  t,
}: {
  code: string;
  data: CitizenServiceModule;
  renderIcon?: (code: string) => React.ReactNode;
  t: (k: string) => string;
}) {
  const links = (data.links ?? [])
    .filter((l) => !!l?.link)
    .sort((a: any, b: any) => (a?.orderNumber ?? 0) - (b?.orderNumber ?? 0));
  if (links.length === 0) return null;
  return (
    <Card style={{ padding: "20px 20px 12px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {renderIcon ? (
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "2rem",
              width: "2rem",
              borderRadius: "9999px",
              backgroundColor:
                "var(--color-primary-selected-bg, #FFF4D7)",
              color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
              flexShrink: 0,
            }}
          >
            {renderIcon(code)}
          </span>
        ) : null}
        <h2
          style={{
            fontSize: "1rem",
            fontWeight: 600,
            color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
            margin: 0,
            lineHeight: 1.3,
          }}
        >
          {t(data.header ?? "")}
        </h2>
      </header>
      <ul
        role="list"
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {links.map((link, i) => {
          const label = link.i18nKey ? link.i18nKey : t(link.name ?? "");
          const href = link.link ?? "#";
          const isExternal = /^https?:\/\//i.test(href);
          const inner = (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "10px 8px",
                borderRadius: "6px",
                fontSize: "0.875rem",
                color: "var(--color-text-heading, #363636)",
                transition: "background-color 0.15s ease-out, color 0.15s ease-out",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "var(--color-primary-selected-bg, #FFF4D7)";
                (e.currentTarget as HTMLElement).style.color =
                  "var(--color-primary-1, var(--color-primary-main, #c84c0e))";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                (e.currentTarget as HTMLElement).style.color =
                  "var(--color-text-heading, #363636)";
              }}
            >
              <span style={{ flex: 1 }}>{label}</span>
              <ChevronRight
                style={{
                  height: "1rem",
                  width: "1rem",
                  flexShrink: 0,
                  color: "var(--color-text-secondary, #6B7280)",
                }}
                aria-hidden
              />
            </span>
          );
          return (
            <li key={`${href}-${i}`}>
              {isExternal ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  {inner}
                </a>
              ) : (
                <Link
                  to={{ pathname: href, state: link.state } as any}
                  style={{
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function CitizenServices({ modules, renderIcon, title }: CitizenServicesProps) {
  const { t } = useTranslation();

  const codes = React.useMemo(
    () => Object.keys(modules || {}).filter((code) => !!modules[code]?.links?.length),
    [modules]
  );

  // i18n fallback — react-i18next echoes the key back when no translation
  // is registered. Use the legacy CS_HOME_HEADER key first, then a
  // sensible English string instead of showing the raw token.
  const resolvedTitle = (() => {
    if (title !== undefined) return title;
    const key = "CS_HOME_HEADER";
    const v = t(key);
    return v === key ? "All Services" : v;
  })();

  return (
    <div
      className="v2-scope"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 0,
        width: "100%",
      }}
    >
      <header
        style={{
          padding: "1rem 1.5rem 0.5rem 1.5rem",
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            margin: 0,
            color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
            lineHeight: 1.25,
          }}
        >
          {resolvedTitle}
        </h1>
      </header>
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          padding: "1rem 1.5rem 1.5rem 1.5rem",
        }}
      >
        {codes.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary, #6B7280)" }}>
            {t("CS_HOME_NO_SERVICES_AVAILABLE") || "No services available."}
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              // Adaptive layout: with ≤2 modules (the common case on
              // single-service tenants like naipepea), give each card a
              // calm full-width row so the page doesn't feel under-filled.
              // From 3 modules onward, fall back to the auto-fill grid so
              // information density scales for module-heavy tenants.
              gridTemplateColumns:
                codes.length <= 2
                  ? "minmax(0, 1fr)"
                  : "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "1rem",
              alignItems: "start",
            }}
          >
            {codes.map((code) => (
              <ModuleCard
                key={code}
                code={code}
                data={modules[code] as CitizenServiceModule}
                renderIcon={renderIcon}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
