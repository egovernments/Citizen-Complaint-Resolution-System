package org.egov.novubridge.service.account;

import org.egov.novubridge.util.Values;

/**
 * One tenant's own Novu account: an organization the bridge created for a root tenant, and the
 * API key of the environment the bridge sends through. The deployment's shared account is NOT
 * modelled by an instance: everywhere a {@code NovuAccount} is accepted, {@code null} means "the
 * shared account" ({@code NOVU_API_KEY}), so unprovisioned tenants keep running the exact code
 * path they ran before per-tenant accounts existed.
 *
 * <p>{@link #toString()} never prints the key.
 */
public record NovuAccount(String tenantRoot, String organizationId, String environmentId, String apiKey) {

    /** Stable cache key: changes when the key does (re-provision after a deprovision regenerates it). */
    public String cacheKey() {
        return "tenant:" + tenantRoot + ":" + organizationId + ":" + Values.stableId(apiKey == null ? "" : apiKey);
    }

    /** "shared" for null, else {@code tenant:<root>}: what the ledger and logs record. */
    public static String label(NovuAccount account) {
        return account == null ? "shared" : "tenant:" + account.tenantRoot();
    }

    @Override
    public String toString() {
        return "NovuAccount[" + tenantRoot + ", org=" + organizationId + ", env=" + environmentId + "]";
    }
}
