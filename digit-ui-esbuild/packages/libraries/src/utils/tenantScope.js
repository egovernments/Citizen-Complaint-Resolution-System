// the counties (direct child tenants) a signed-in employee can ENTER from a state.
// The identity service's rule (#1759): a role held at a tenant, or at an ancestor of it, opens it; a role held at a
// sibling or another root never does. The state admin's boundary trees at /<state> (Request's guard) and the File a
// Complaint county picker both list exactly these - never a county the user cannot open.

/** Direct child tenants of `tenantId` (code `<tenantId>.<x>`), as the init data lists them, by code. */
export function childTenants(tenantId, tenants) {
  const prefix = `${String(tenantId || "")}.`;
  return (tenants || [])
    .filter((t) => t && typeof t.code === "string" && t.code.startsWith(prefix) && !t.code.slice(prefix.length).includes("."))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** The user may enter `tenantCode`: a role held there or at an ancestor of it. */
export function canEnter(tenantCode, roles) {
  const code = String(tenantCode || "").toLowerCase();
  return (roles || []).some((r) => {
    const at = String(r?.tenantId || "").toLowerCase();
    return at && (at === code || code.startsWith(`${at}.`));
  });
}

/** The child tenants of `tenantId` the user can enter (tenant objects, by code). */
export function enterableChildTenants(tenantId, tenants, roles) {
  return childTenants(tenantId, tenants).filter((t) => canEnter(t.code, roles));
}

/** The route slug of a tenant: its own urlSlug, else the code lower-cased with "." -> "-" (ke.bomet -> ke-bomet). */
export function tenantSlug(tenant) {
  return tenant?.urlSlug || String(tenant?.code || "").toLowerCase().replace(/\./g, "-");
}
