// Read-only display helper for the PGR "extended attributes" on the complaint
// DETAIL pages (citizen + employee).
//
// The frontend only FETCHES service.extendedAttributes and SHOWS it — the
// backend handles everything else: confidentiality masking returns the values
// already as "****", decryption, viewer-role checks, etc. So this is a pure
// value -> row mapper: NO schema fetch, NO masking logic, NO translation of the
// values themselves.

import React from "react";

import { prettifyKey, fieldsFromSchema } from "../utils/extendedAttributes";

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
  // complainantAddress renders as the VALUE of the main Address row on both
  // details pages (product call, sheet-v4 review) — skipping it here avoids
  // a duplicate row in the Additional Details card.
  "complainantAddress",
  // receivedChannel now travels as service.source (product call) and is not
  // a display row; skipping also hides it on complaints created while it
  // briefly lived in extendedAttributes.
  "receivedChannel",
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
// CCSD-2123: the backend returns extendedAttributes in Postgres jsonb key
// order — key LENGTH, then bytewise — so witnessName (11 chars) always came
// out ahead of complainantName (15) and the witness led the card.
//
// Display order:
//   1. complainantName is ALWAYS first (primary subject of the record). This
//      one is pinned in code because it is not a schema field — the citizen
//      wizard writes it as a free key under additionalProperties, so no
//      x-order can ever cover it.
//   2. Schema fields follow the SAME x-order the create form renders with
//      (pass orderedKeys from useExtendedAttributeOrder below).
//   3. Anything else keeps its incoming relative order (sort is stable).
const rankOf = (k, orderedKeys) => {
  if (k === "complainantName") return -1;
  const i = orderedKeys ? orderedKeys.indexOf(k) : -1;
  return i === -1 ? 999 : i;
};

// Resolve the display order for a complaint's extendedAttributes from the
// SAME masters the create forms use: ComplaintTemplateType (caseRelatedTo →
// schemaRef) + ComplaintExtendedAttributeSchema (schemaRef → schema with
// x-order). Returns the ordered fieldKey list, or null while loading / when
// the category has no schema — callers just get jsonb order until then.
// Mirrors createComplaintForm.js: state-tenant fetch, cached forever.
export function useExtendedAttributeOrder(extendedAttributes) {
  const caseRelatedTo = extendedAttributes && extendedAttributes.caseRelatedTo;
  const stateTenant = (Digit?.ULBService?.getCurrentTenantId?.() || "").split(".")[0];
  const { data: templates } = Digit.Hooks.useCustomMDMS(stateTenant, "RAINMAKER-PGR", [{ name: "ComplaintTemplateType" }], {
    cacheTime: Infinity,
    select: (raw) => raw?.["RAINMAKER-PGR"]?.ComplaintTemplateType || [],
  });
  const { data: schemasByRef } = Digit.Hooks.useCustomMDMS(stateTenant, "RAINMAKER-PGR", [{ name: "ComplaintExtendedAttributeSchema" }], {
    cacheTime: Infinity,
    select: (raw) => {
      const rows = raw?.["RAINMAKER-PGR"]?.ComplaintExtendedAttributeSchema || [];
      return rows.reduce((acc, r) => {
        if (r && r.schemaRef) acc[r.schemaRef] = r.schema;
        return acc;
      }, {});
    },
  });
  return React.useMemo(() => {
    if (!caseRelatedTo || !templates || !schemasByRef) return null;
    const tpl = templates.find((x) => x && x.caseRelatedTo === caseRelatedTo);
    const fields = fieldsFromSchema(tpl && schemasByRef[tpl.schemaRef]);
    return fields.length ? fields.map((f) => f.fieldKey) : null;
  }, [caseRelatedTo, templates, schemasByRef]);
}

export function buildExtendedAttributeRows(extendedAttributes, t, orderedKeys) {
  if (!extendedAttributes || typeof extendedAttributes !== "object") return [];
  return Object.keys(extendedAttributes)
    .filter((k) => !SKIP_KEYS.has(k))
    .sort((a, b) => rankOf(a, orderedKeys) - rankOf(b, orderedKeys))
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
