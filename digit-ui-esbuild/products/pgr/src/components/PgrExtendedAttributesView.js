// Read-only display helper for the PGR "extended attributes" on the complaint
// DETAIL pages (citizen + employee).
//
// The frontend only FETCHES service.extendedAttributes and SHOWS it — the
// backend handles everything else: confidentiality masking returns the values
// already as "****", decryption, viewer-role checks, etc. So this is a pure
// value -> row mapper: NO schema fetch, NO masking logic, NO translation of the
// values themselves.

import { prettifyKey } from "../utils/extendedAttributes";

// Internal / control keys that are not user-facing data rows: the discriminator,
// the confidentiality flag, the schema version, the hierarchy breadcrumbs (which
// already render as the complaint type / sub-type), and the user-service-bound
// contact fields. Everything else in extendedAttributes is shown verbatim.
const SKIP_KEYS = new Set([
  "caseRelatedTo",
  "isConfidential",
  "schemaVersion",
  "hierarchyLevel1",
  "hierarchyLevel2",
  "complainantAddress",
  "email",
  // Moz QA (CCSD-1988): consents are an internal acceptance record, not a
  // user-facing data row — never show them on the view screens.
  "consents",
]);

function formatValue(v) {
  if (v === null || v === undefined || v === "") return "NA";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    return (
      v
        .map((x) => (x && typeof x === "object" ? x.code ?? x.name ?? "" : x))
        .filter((x) => x !== "" && x !== null && x !== undefined)
        .join(", ") || "NA"
    );
  }
  if (typeof v === "object") return String(v.code ?? v.name ?? "") || "NA";
  // Strings — including the backend-masked "****" — pass through unchanged.
  return String(v);
}

// fieldKey -> the PGR_EXT_<SNAKE>_LABEL localization key the MDMS schemas use
// (instituteName -> PGR_EXT_INSTITUTE_NAME_LABEL). Same convention as the
// x-label-key values in ComplaintExtendedAttributeSchema.
const labelKeyOf = (k) => `PGR_EXT_${k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_LABEL`;

// Map a flat service.extendedAttributes object to ordered { fieldKey, label,
// value } rows. Returns [] when there is nothing to show, so callers render
// nothing (graceful gating — safe before the backend read side ships).
// Pass t to localize the labels; the prettified English key remains the
// fallback whenever a PGR_EXT_* key is not in the loaded bundle.
export function buildExtendedAttributeRows(extendedAttributes, t) {
  if (!extendedAttributes || typeof extendedAttributes !== "object") return [];
  return Object.keys(extendedAttributes)
    .filter((k) => !SKIP_KEYS.has(k))
    .map((k) => {
      const lk = labelKeyOf(k);
      const translated = typeof t === "function" ? t(lk) : lk;
      return {
        fieldKey: k,
        label: translated !== lk ? translated : prettifyKey(k),
        value: formatValue(extendedAttributes[k]),
      };
    });
}
