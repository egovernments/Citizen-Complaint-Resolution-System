// Shared helpers for the PGR "extended attributes" (per-category dynamic fields).
// Used by the employee create form (and reusable by the citizen wizard). The
// per-category field set is defined in a JSON Schema stored in the MDMS master
// RAINMAKER-PGR.ComplaintExtendedAttributeSchema (keyed by schemaRef), referenced
// from RAINMAKER-PGR.ComplaintTemplateType.

// camelCase fieldKey → "Title Case" fallback label.
export function prettifyKey(k) {
  const s = String(k || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Build renderable field descriptors from a draft-07 JSON Schema object
// (properties + required + x-security + the x-order / x-widget / x-label-key UI
// hints). Control/standard keys are skipped (sent automatically, not rendered).
export function fieldsFromSchema(schema) {
  if (!schema || typeof schema !== "object" || !schema.properties) return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const security = Array.isArray(schema["x-security"]) ? schema["x-security"] : [];
  const CONTROL = new Set([
    "caseRelatedTo",
    "isConfidential",
    "schemaVersion",
    "hierarchyLevel1",
    "hierarchyLevel2",
    "complainantAddress",
    "email",
  ]);
  return Object.keys(schema.properties)
    .filter((k) => !CONTROL.has(k))
    .map((k) => {
      const p = schema.properties[k] || {};
      const widget = p["x-widget"];
      const dataType =
        widget === "textarea"
          ? "textarea"
          : p.format === "date"
          ? "date"
          : p.type === "number" || p.type === "integer"
          ? "number"
          : p.type === "boolean"
          ? "boolean"
          : "string";
      return {
        fieldKey: k,
        labelKey: p["x-label-key"],
        label: prettifyKey(k),
        dataType,
        mandatory: required.includes(k),
        maxLength: typeof p.maxLength === "number" ? p.maxLength : undefined,
        order: typeof p["x-order"] === "number" ? p["x-order"] : 999,
        encrypted: security.includes(k),
      };
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Reverse-map an employee's login tenant (e.g. "mz.ige") to a category code via
// ComplaintRelatedToMap.tenantCode. Returns the code (e.g. "IGE") or null when
// the tenant isn't mapped (so callers can fall back to the plain form).
export function deriveCaseRelatedTo(relatedToMapRows, tenantId) {
  if (!Array.isArray(relatedToMapRows) || !tenantId) return null;
  const row = relatedToMapRows.find((r) => r?.active !== false && r?.tenantCode === tenantId);
  return row?.code || null;
}
