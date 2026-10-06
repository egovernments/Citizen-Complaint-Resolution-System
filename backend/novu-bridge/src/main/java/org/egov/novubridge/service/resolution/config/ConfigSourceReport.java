package org.egov.novubridge.service.resolution.config;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The {@code GET /config/source} answer: which namespace serves each master for a tenant. There is
 * no setting that picks the namespace (the data does, per tenant), so this is how it is observed.
 */
public final class ConfigSourceReport {

    /**
     * One master's answer. {@code legacy}: served by the legacy adapter because the new master was
     * empty. {@code stale}: rows from a cache entry past its TTL because MDMS was unreachable.
     */
    public record MasterSource(String master, String schemaCode, int rows, boolean legacy, boolean stale) {
    }

    private final String tenantId;
    private final String stateTenantId;
    private final Map<String, MasterSource> masters = new LinkedHashMap<>();

    public ConfigSourceReport(String tenantId, String stateTenantId) {
        this.tenantId = tenantId;
        this.stateTenantId = stateTenantId;
    }

    public ConfigSourceReport with(MasterSource source) {
        masters.put(source.master(), source);
        return this;
    }

    public String getTenantId() { return tenantId; }

    /** The tenant the masters were actually read at: they are held at the state root. */
    public String getStateTenantId() { return stateTenantId; }

    public Map<String, MasterSource> getMasters() { return masters; }

    public boolean isAnyLegacy() {
        return masters.values().stream().anyMatch(MasterSource::legacy);
    }
}
