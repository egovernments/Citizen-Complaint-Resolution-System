import {
  translate,
  exists,
  existsInLocale,
  translateInLocale,
  findMessageLoose,
  FALLBACK_LOCALE,
  getLanguage,
} from "./localeRuntime";
import {
  humanizeTypeCode,
  humanizeDimensionCode,
  looksLikeTaxonomyCodePath,
} from "../utils/complaintTypeTree";

/**
 * THE single seam between raw dimension codes and display text. Every place
 * the dashboard renders a data value as a label must route through here with
 * the right `kind`.
 *
 * Resolution order:
 *   1. active-locale message (getResource / side-cache — never i18next
 *      fallbackLng bleed). Messages that are still taxonomy paths
 *      (complaints.categories.* / reclamações.categories.*) are skipped —
 *      machine-translated seeds sometimes "translate" the code itself (#1108).
 *   2. en_IN message for boundary always (place names). For complaintType,
 *      only when the UI language *is* en_IN — otherwise Portuguese would
 *      silently show English titles after skipping a bad pt path seed.
 *   3. boundary: underscore-insensitive pack lookup (KONGASIS → KONG_ASIS)
 *   4. fallbackText — DATA-OWNED only (MDMS display name, boundary localname),
 *      skipped when it is itself a taxonomy path / equals the code
 *   5. complaintType → humanizeTypeCode; boundary/department → humanizeDimensionCode
 *   6. raw code
 *
 * Key conventions per kind mirror what the configurator seeds:
 *   complaintType  → COMPLAINT_HIERARCHY.<code> (SERVICEDEFS.<CODE> legacy)
 *   boundary       → bare <code> in rainmaker-boundary-<hierarchy> (#1002)
 *   department     → COMMON_MASTERS_DEPARTMENT_<CODE> in rainmaker-common
 *   workflowStatus → DASHBOARD_WF_STAGE_<STATUS>, then platform CS_COMMON_*
 *   channel/slaState/ageBucket → dashboard-owned DASHBOARD_* keys
 */
const transform = (code) =>
  String(code)
    .toUpperCase()
    .replace(/[.:\-\s/]+/g, "_");

const CANDIDATES = {
  // Also try the last dotted segment — MDMS tree codes are often
  // complaints.categories.DamagedRoad while seeds live under DAMAGEDROAD.
  complaintType: (c) => {
    const raw = String(c);
    const upper = raw.toUpperCase();
    const last = raw.split(".").filter(Boolean).pop() || raw;
    const lastUpper = last.toUpperCase();
    return [
      `COMPLAINT_HIERARCHY.${raw}`,
      `COMPLAINT_HIERARCHY.${upper}`,
      `COMPLAINT_HIERARCHY.${last}`,
      `COMPLAINT_HIERARCHY.${lastUpper}`,
      `SERVICEDEFS.${upper}`,
      `SERVICEDEFS.${lastUpper}`,
    ];
  },
  boundary: (c) => {
    const raw = String(c);
    const keys = [raw, transform(raw)];
    // Prefixed admin keys used by some boundary packs
    keys.push(`KE_ADMIN_${raw}`, `KE_ADMIN_${transform(raw)}`);
    return keys;
  },
  department: (c) => [`COMMON_MASTERS_DEPARTMENT_${transform(c)}`, `DEPARTMENT_${transform(c)}`],
  workflowStatus: (c) => [
    `DASHBOARD_WF_STAGE_${transform(c)}`,
    `CS_COMMON_${transform(c)}`,
    `WF_PGR_${transform(c)}`,
  ],
  channel: (c) => [`DASHBOARD_CHANNEL_${transform(c)}`],
  slaState: (c) => [`DASHBOARD_SLA_${transform(c)}`],
  ageBucket: (c) => [`DASHBOARD_AGE_${transform(c)}`],
};

/** True when a resolved string is fit to show as a complaint-type title. */
function usableComplaintLabel(text, code) {
  if (text == null || text === "") return false;
  const s = String(text);
  if (s === String(code)) return false;
  if (looksLikeTaxonomyCodePath(s)) return false;
  return true;
}

function shouldTryEnIn(kind) {
  if (kind === "boundary") return true;
  if (kind === "complaintType") return getLanguage() === FALLBACK_LOCALE;
  return false;
}

function usableFallbackText(kind, text, code) {
  if (text == null || text === "") return false;
  if (String(text) === String(code)) return false;
  if (kind === "complaintType") return usableComplaintLabel(text, code);
  // boundary-service often echoes the code as localname — treat as missing
  return true;
}

/**
 * @param code raw dimension value (service code, boundary code, dept code, …)
 * @param kind one of the CANDIDATES keys; unknown kinds surface the raw code
 * @param fallbackText DATA-OWNED display name (API localname / MDMS name)
 *   only — omit everywhere else so unlocalized codes surface verbatim
 */
export function dimensionLabel(code, kind, fallbackText) {
  if (code == null || code === "") return fallbackText !== undefined ? fallbackText : "";
  const raw = String(code);
  // Analytics null-buckets land as the literal "Unknown" — use the dashboard
  // chrome key (pt: Desconhecido) instead of humanising the English word.
  if (/^(unknown|null|undefined)$/i.test(raw.trim())) {
    return translate("DASHBOARD_COMMON_UNKNOWN", "Unknown");
  }
  const candidates = (CANDIDATES[kind] || (() => []))(code);
  const accept = (msg) =>
    kind === "complaintType" ? usableComplaintLabel(msg, code) : msg != null && msg !== "";

  for (const key of candidates) {
    if (exists(key)) {
      const msg = translate(key);
      if (accept(msg)) return msg;
    }
  }
  if (shouldTryEnIn(kind)) {
    for (const key of candidates) {
      if (existsInLocale(key, FALLBACK_LOCALE)) {
        const msg = translateInLocale(key, FALLBACK_LOCALE);
        if (accept(msg)) return msg;
      }
    }
  }
  // Analytics ward codes sometimes drop underscores vs the pack
  // (BOMET_CHEPALUNGU_KONGASIS vs …KONG_ASIS → Kong'asis).
  if (kind === "boundary") {
    const loose =
      findMessageLoose(code, getLanguage()) || findMessageLoose(code, FALLBACK_LOCALE);
    if (loose) return loose;
  }
  if (fallbackText !== undefined && usableFallbackText(kind, fallbackText, code)) {
    if (kind === "complaintType") {
      // MDMS display names are English on this tenant. Only use them when the
      // UI language is en_IN — otherwise they re-bleed English into pt_PT
      // after a path-shaped seed was skipped (#1108).
      if (getLanguage() === FALLBACK_LOCALE) return fallbackText;
    } else {
      return fallbackText;
    }
  }
  if (kind === "complaintType") return humanizeTypeCode(code);
  if (kind === "boundary" || kind === "department") return humanizeDimensionCode(code);
  return String(code);
}
