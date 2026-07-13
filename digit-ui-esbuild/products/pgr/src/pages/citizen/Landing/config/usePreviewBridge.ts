// Builder-preview bridge (P4, CCSD-2009).
//
// Lets the Configurator's Landing Page Builder drive this page as a live
// preview inside an iframe. IMPORTANT ARCHITECTURE NOTE: this hook is glue in
// the page ENTRY (index.tsx), not in LandingRenderer — the renderer stays
// completely Builder-unaware and always receives a plain ResolvedLandingConfig,
// whether it came from MDMS (production) or from a postMessage (preview).
//
// Activation is deliberately narrow: the bridge only engages when BOTH
//   1. the URL carries ?builderPreview=1, AND
//   2. the page is actually embedded (window.parent !== window),
// and it only accepts messages from the SAME ORIGIN (the Configurator is
// served from the same host). Until the first config message arrives the page
// renders nothing — previewed data never persists anywhere, and a stray
// visitor hitting the URL directly gets the normal page (not embedded).
//
// Message protocol (all payloads {type, ...}):
//   in:  pgrl-preview-config  { config: ResolvedLandingConfig }
//   in:  pgrl-preview-scroll  { code: string }   scroll to a section
//   out: pgrl-preview-ready   {}                 posted once on mount

import * as React from "react";
import type { ResolvedLandingConfig } from "./types";

/** Section code -> DOM anchor rendered by the section components. */
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
  // URL + embedding don't change for the page's lifetime.
  const active = React.useMemo(detectActive, []);
  const [config, setConfig] = React.useState<ResolvedLandingConfig | null>(null);

  React.useEffect(() => {
    if (!active) return;

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return; // same-origin only
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "pgrl-preview-config" && msg.config && typeof msg.config === "object") {
        setConfig(msg.config as ResolvedLandingConfig);
      } else if (msg.type === "pgrl-preview-scroll" && typeof msg.code === "string") {
        if (msg.code === "navigation") {
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        if (msg.code === "footer") {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
          return;
        }
        const el = document.getElementById(SCROLL_ANCHORS[msg.code] || "");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    window.addEventListener("message", onMessage);
    // Handshake: tell the Builder we can receive config now.
    try {
      window.parent.postMessage({ type: "pgrl-preview-ready" }, window.location.origin);
    } catch {
      /* ignore */
    }
    return () => window.removeEventListener("message", onMessage);
  }, [active]);

  return { active, config };
}
