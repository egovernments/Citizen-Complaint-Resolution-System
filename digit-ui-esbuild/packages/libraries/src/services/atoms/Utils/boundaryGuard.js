// No boundary-relationships read at a tenant WITHOUT a boundary hierarchy.
//
// A state whose boundaries live at its child tenants has no hierarchy of its own, and
// boundary-relationships/_search there answers 400 HIERARCHY_DEFINITION_DOES_NOT_EXIST. Several readers ask it at the
// session tenant (pgr PGRInitialization and BoundaryService, useTenantBoundaries, PGRDetails, useComplaintDetails,
// Location.js, BoundaryFilter, HRMS jurisdiction), so the state admin's File a Complaint and inbox logged a 400 each
// time. One guard where every request passes (Request): a relationships search for a tenant whose hierarchy
// definitions were READ and are NONE is answered with an empty tree (what the readers already degrade to) instead of
// being sent. Unknown (the definition search failed) is sent as before. Only a positive answer is cached: onboarding
// creates a hierarchy and reads it in the same session.

const RELATIONSHIPS = /\/boundary-relationships\/_search(?:$|\?)/;
const known = new Set();

/** The tenant and hierarchy type a relationships search asks for (query params, or the URL's own query string). */
export function relationshipsTarget(url, params) {
  const path = String(url || "");
  if (!RELATIONSHIPS.test(path)) return null;
  const q = path.includes("?") ? new URLSearchParams(path.slice(path.indexOf("?") + 1)) : new URLSearchParams();
  const tenantId = (params && params.tenantId) || q.get("tenantId");
  if (!tenantId) return null;
  return { tenantId: String(tenantId), hierarchyType: (params && params.hierarchyType) || q.get("hierarchyType") || undefined };
}

/**
 * True when the request is a relationships search at a tenant that has NO hierarchy definition (of that type):
 * the caller answers it with emptyTenantBoundary() instead of sending it. `search(criteria)` asks
 * boundary-hierarchy-definition/_search and returns its JSON (or throws).
 */
export async function hierarchyMissing(url, params, search) {
  const target = relationshipsTarget(url, params);
  if (!target) return false;
  const key = `${target.tenantId}|${target.hierarchyType || ""}`;
  if (known.has(key)) return false;
  try {
    const res = await search({ tenantId: target.tenantId, ...(target.hierarchyType && { hierarchyType: target.hierarchyType }), limit: 1, offset: 0 });
    const n = Number(res?.totalCount ?? (Array.isArray(res?.BoundaryHierarchy) ? res.BoundaryHierarchy.length : NaN));
    if (Number.isNaN(n)) return false; // an unexpected answer: send the search as before
    if (n > 0) known.add(key);
    return n === 0;
  } catch (e) {
    return false; // unknown: send it as before
  }
}

export const emptyTenantBoundary = () => ({ ResponseInfo: { status: "successful" }, TenantBoundary: [] });

/** tests only */
export const _resetBoundaryGuard = () => known.clear();
