/**
 * The localization key of a tenant's display name: TENANT_TENANTS_<code upper-cased, EVERY dot as _>
 * (ke.bomet -> TENANT_TENANTS_KE_BOMET; ke.bomet.health.water -> TENANT_TENANTS_KE_BOMET_HEALTH_WATER).
 * `replace(".", "_")` replaced only the first dot, so a tenant below the city level showed its raw key.
 */
export const tenantLabelKey = (code) => `TENANT_TENANTS_${String(code || "").toUpperCase().replace(/\./g, "_")}`;
