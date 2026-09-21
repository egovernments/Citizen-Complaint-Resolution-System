package org.egov.novubridge.service.resolution.config;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * What {@code GET /novu-adapter/v1/config/source} answers: which namespace is serving each master
 * for a tenant, and how many rows it found.
 *
 * <p><b>Observability, not a flag.</b> There is no setting that chooses between the new
 * {@code NOTIFICATIONS.*} masters and the legacy {@code RAINMAKER-PGR.Notification*} ones — the
 * data chooses, per tenant, all-or-nothing. This is how that choice becomes readable, so two
 * tenants on the same build serving from different namespaces is a thing an operator can see
 * rather than a thing they discover from a missing message.
 */
public final class ConfigSourceReport {

    /** One master's answer. */
    public static final class MasterSource {
        private final String master;
        private final String schemaCode;
        private final int rows;
        private final boolean legacy;
        private final boolean stale;

        public MasterSource(String master, String schemaCode, int rows, boolean legacy, boolean stale) {
            this.master = master;
            this.schemaCode = schemaCode;
            this.rows = rows;
            this.legacy = legacy;
            this.stale = stale;
        }

        public String getMaster() { return master; }

        /** The MDMS schema code actually read, e.g. {@code NOTIFICATIONS.Routing}. */
        public String getSchemaCode() { return schemaCode; }

        public int getRows() { return rows; }

        /** True when the legacy adapter served this master because the new one had no rows. */
        public boolean isLegacy() { return legacy; }

        /** True when the rows came from a cache entry older than its TTL, MDMS being unreachable. */
        public boolean isStale() { return stale; }
    }

    private final String tenantId;
    private final String stateTenantId;
    private final Map<String, MasterSource> masters = new LinkedHashMap<>();

    public ConfigSourceReport(String tenantId, String stateTenantId) {
        this.tenantId = tenantId;
        this.stateTenantId = stateTenantId;
    }

    public ConfigSourceReport with(MasterSource source) {
        masters.put(source.getMaster(), source);
        return this;
    }

    public String getTenantId() { return tenantId; }

    /** The tenant the masters were actually read at — they are held at the state root. */
    public String getStateTenantId() { return stateTenantId; }

    public Map<String, MasterSource> getMasters() { return masters; }

    /** True when ANY master is still being served from the legacy namespace. */
    public boolean isAnyLegacy() {
        return masters.values().stream().anyMatch(MasterSource::isLegacy);
    }
}
