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

// Map a flat service.extendedAttributes object to ordered { fieldKey, label,
// value } rows. Returns [] when there is nothing to show, so callers render
// nothing (graceful gating — safe before the backend read side ships).
export function buildExtendedAttributeRows(extendedAttributes) {
  if (!extendedAttributes || typeof extendedAttributes !== "object") return [];
  return Object.keys(extendedAttributes)
    .filter((k) => !SKIP_KEYS.has(k))
    .map((k) => ({
      fieldKey: k,
      label: prettifyKey(k),
      value: formatValue(extendedAttributes[k]),
    }));
}
