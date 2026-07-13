// Builder-preview bridge v2 (P4, CCSD-2009).
//
// Glue in the page ENTRY (index.tsx), never in LandingRenderer — the renderer
// stays Builder-unaware and always receives a plain ResolvedLandingConfig.
// Activates only when embedded (window.parent !== window) with
// ?builderPreview=1, and talks to the SAME ORIGIN only. Nothing persists
// through this path.
//
// Protocol ({type, ...}; "in" = from Builder, "out" = to Builder):
//   in:  pgrl-preview-config    { config, messages?, locale? }
//          messages: {locale: {i18nKey: text}} — the Builder's STAGED
//          localization edits, applied to the live i18n store so inline text
//          edits preview instantly; locale switches the display language.
//   in:  pgrl-preview-scroll    { code }
//   in:  pgrl-preview-highlight { code | null }    Figma-style outline + label
//   out: pgrl-preview-ready     {}
//   out: pgrl-preview-hover     { code | null }
//   out: pgrl-preview-select    { code, field? }   click; field set for known
//                                                  editable elements (titles)
//
// Navigation is BLOCKED in preview mode: link clicks become select messages
// instead of navigating the iframe away from the page.

import * as React from "react";
import { useTranslation } from "react-i18next";
import type { ResolvedLandingConfig } from "./types";

/** Section code -> DOM anchor id rendered by the section components. */
const SCROLL_ANCHORS: Record<string, string> = {
  hero: "pgr-landing-hero-title",
  types: "pgr-landing-types",
  steps: "pgr-landing-how",
  channels: "pgr-landing-channels",
  privacy: "pgr-landing-privacy",
  news: "pgr-landing-news",
  institutions: "pgr-landing-institutions",
  cta: "pgr-landing-final-title",
};

/** Element ids mapping to a specific editable property (click-to-edit). */
const FIELD_ANCHORS: Record<string, { code: string; field: string }> = {
  "pgr-landing-hero-title": { code: "hero", field: "titleKey" },
  "pgr-landing-types-title": { code: "types", field: "titleKey" },
  "pgr-landing-how-title": { code: "steps", field: "titleKey" },
  "pgr-landing-channels-title": { code: "channels", field: "titleKey" },
  "pgr-landing-privacy-title": { code: "privacy", field: "titleKey" },
  "pgr-landing-news-title": { code: "news", field: "titleKey" },
  "pgr-landing-institutions-title": { code: "institutions", field: "titleKey" },
  "pgr-landing-final-title": { code: "cta", field: "titleKey" },
};

/** Resolve the section root element for a code (anchor may be a heading). */
function sectionRoot(code: string): HTMLElement | null {
  if (code === "navigation")
    return document.querySelector(".pgr-landing header") as HTMLElement | null;
  if (code === "footer")
    return document.querySelector(".pgr-landing footer") as HTMLElement | null;
  const el = document.getElementById(SCROLL_ANCHORS[code] || "");
  if (!el) return null;
  return (el.closest("section") as HTMLElement) ?? el;
}

/** Which section does a DOM node belong to? */
function codeForNode(node: HTMLElement): string | null {
  const sec = node.closest("section, header, footer, nav") as HTMLElement | null;
  if (!sec) return null;
  if (sec.tagName === "FOOTER") return "footer";
  if (sec.tagName === "HEADER" || sec.tagName === "NAV") return "navigation";
  for (const [code, anchor] of Object.entries(SCROLL_ANCHORS)) {
    const a = document.getElementById(anchor);
    if (a && sec.contains(a)) return code;
  }
  return null;
}

export interface PreviewBridge {
  /** true when embedded with ?builderPreview=1 — the entry should render from
   *  `config` (or nothing while null) instead of fetching MDMS. */
  active: boolean;
  config: ResolvedLandingConfig | null;
}

function detectActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.parent === window) return false;
    return /[?&]builderPreview=1\b/.test(window.location.search || "");
  } catch {
    return false;
  }
}

export function usePreviewBridge(): PreviewBridge {
  const active = React.useMemo(detectActive, []);
  const [config, setConfig] = React.useState<ResolvedLandingConfig | null>(null);
  const { i18n } = useTranslation();
  const i18nRef = React.useRef(i18n);
  i18nRef.current = i18n;
  const highlightRef = React.useRef<{ el: HTMLElement; label: HTMLElement } | null>(null);

  React.useEffect(() => {
    if (!active) return;
    const origin = window.location.origin;
    const post = (payload: Record<string, unknown>) => {
      try {
        window.parent.postMessage(payload, origin);
      } catch {
        /* ignore */
      }
    };

    const clearHighlight = () => {
      const h = highlightRef.current;
      if (h) {
        h.el.style.outline = "";
        h.el.style.outlineOffset = "";
        h.label.remove();
        highlightRef.current = null;
      }
    };

    const applyHighlight = (code: string | null) => {
      clearHighlight();
      if (!code) return;
      const el = sectionRoot(code);
      if (!el) return;
      el.style.outline = "2px solid #7c3aed";
      el.style.outlineOffset = "-2px";
      const label = document.createElement("div");
      label.textContent = code.toUpperCase();
      label.setAttribute("aria-hidden", "true");
      label.style.cssText =
        "position:absolute;z-index:70;background:#7c3aed;color:#fff;font:600 10px/1.7 sans-serif;" +
        "padding:0 7px;border-radius:0 0 4px 0;pointer-events:none;letter-spacing:.08em;";
      const rect = el.getBoundingClientRect();
      label.style.top = `${rect.top + window.scrollY}px`;
      label.style.left = `${rect.left + window.scrollX}px`;
      document.body.appendChild(label);
      highlightRef.current = { el, label };
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "pgrl-preview-config" && msg.config && typeof msg.config === "object") {
        // Staged localization edits — live in the i18n store, never persisted
        // from here. Cover both namespace spellings used across the app.
        if (msg.messages && typeof msg.messages === "object") {
          Object.entries(msg.messages as Record<string, Record<string, string>>).forEach(
            ([lng, res]) => {
              try {
                i18nRef.current?.addResources?.(lng, "translations", res);
                i18nRef.current?.addResources?.(lng, "translation", res);
              } catch {
                /* ignore */
              }
            }
          );
        }
        if (typeof msg.locale === "string" && msg.locale && i18nRef.current?.language !== msg.locale) {
          try {
            i18nRef.current?.changeLanguage?.(msg.locale);
          } catch {
            /* ignore */
          }
        }
        setConfig({ ...(msg.config as ResolvedLandingConfig) });
      } else if (msg.type === "pgrl-preview-scroll" && typeof msg.code === "string") {
        if (msg.code === "navigation") window.scrollTo({ top: 0, behavior: "smooth" });
        else if (msg.code === "footer")
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        else sectionRoot(msg.code)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (msg.type === "pgrl-preview-highlight") {
        applyHighlight(typeof msg.code === "string" ? msg.code : null);
      }
    };

    // Hover -> tell the Builder which section the pointer is over.
    let lastHover: string | null = null;
    const onPointerOver = (e: Event) => {
      const t = e.target as HTMLElement | null;
      const code = t ? codeForNode(t) : null;
      if (code !== lastHover) {
        lastHover = code;
        post({ type: "pgrl-preview-hover", code });
      }
    };

    // Click -> select; block in-preview navigation.
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const withId = t.closest("[id]") as HTMLElement | null;
      if (withId && FIELD_ANCHORS[withId.id]) {
        post({ type: "pgrl-preview-select", ...FIELD_ANCHORS[withId.id] });
        return;
      }
      const code = codeForNode(t);
      if (code) post({ type: "pgrl-preview-select", code });
    };

    window.addEventListener("message", onMessage);
    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("click", onClick, true);
    post({ type: "pgrl-preview-ready" });
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("click", onClick, true);
      clearHighlight();
    };
  }, [active]);

  return { active, config };
}
