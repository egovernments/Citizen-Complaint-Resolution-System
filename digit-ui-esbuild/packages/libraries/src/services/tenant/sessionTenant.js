/**
 * Which stored session belongs to a tenant route, and which tenant an
 * employee's business calls use there.
 *
 * D16 (amended): a root workspace route (`ke`) may sign in an EMPLOYEE whose
 * DIGIT account sits at a child tenant (`ke.nairobi`). Kong authorizes a token
 * against its home tenant, so the Identity BFF mints that token at the
 * account's own tenant, and PGR calls must use it, not the route tenant.
 * Citizens are unchanged: their token sits at the route tenant's root.
 */

const parse = (value) => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (e) { return value; }
};

const userOf = (info) => {
  const parsed = parse(info);
  return parsed && typeof parsed === "object" ? parsed : null;
};

export const sessionTenantOf = (info) => {
  const user = userOf(info);
  return user?.tenantId || user?.tenantid || user?.userInfo?.tenantId || null;
};

const sessionTypeOf = (info) => {
  const user = userOf(info);
  return user?.type || user?.userInfo?.type || null;
};

/** `tenantId` is `rootTenantId` or a child of it; `kex` is never under `ke`. */
export function isTenantWithin(tenantId, rootTenantId) {
  return typeof tenantId === "string" && typeof rootTenantId === "string" && rootTenantId.length > 0 &&
    (tenantId === rootTenantId || tenantId.startsWith(`${rootTenantId}.`));
}

const citizenAccountTenant = (routeTenant) =>
  routeTenant.rootTenantId || routeTenant.tenantId.split(".")[0];

/**
 * A stored session belongs to this route: the route tenant itself; for an
 * employee, a child of it; for a citizen, the route tenant's root, where
 * egov-user keeps the citizen account.
 */
export function sessionBelongsToRoute(info, routeTenant) {
  const tenantId = sessionTenantOf(info);
  if (!tenantId || tenantId === routeTenant.tenantId) return true;
  const type = sessionTypeOf(info);
  if (type === "EMPLOYEE") return isTenantWithin(tenantId, routeTenant.tenantId);
  return type === "CITIZEN" && tenantId === citizenAccountTenant(routeTenant);
}

/**
 * The tenant an employee's business calls use on a route: the signed-in
 * employee's own tenant when it is the route tenant or a child of it, else the
 * route tenant (signed out, a citizen, or anything outside the route).
 */
export function employeeTenantForRoute(info, routeTenantId) {
  const tenantId = sessionTenantOf(info);
  return sessionTypeOf(info) === "EMPLOYEE" && isTenantWithin(tenantId, routeTenantId) ? tenantId : routeTenantId;
}
