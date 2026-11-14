/**
 * A tenant code as a localization key prefix: upper-cased, EVERY dot as _ (ke.bomet.health -> KE_BOMET_HEALTH), the
 * prefix of the boundary labels <TENANT>_<HIERARCHY>_<code> that tenant onboarding writes. `replace(".", "_")`
 * changed only the first dot (KE_BOMET.HEALTH), so a tenant below the city level showed raw keys.
 */
export const tenantKeyPrefix = (code) => String(code || "").toUpperCase().replace(/\./g, "_");

/**
 * The localization key of a tenant's display name: TENANT_TENANTS_<tenantKeyPrefix(code)>
 * (ke.bomet -> TENANT_TENANTS_KE_BOMET; ke.bomet.health.water -> TENANT_TENANTS_KE_BOMET_HEALTH_WATER).
 */
export const tenantLabelKey = (code) => `TENANT_TENANTS_${tenantKeyPrefix(code)}`;
