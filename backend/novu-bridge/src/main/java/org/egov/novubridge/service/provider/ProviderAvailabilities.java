package org.egov.novubridge.service.provider;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.account.NovuAccount;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * One {@link ProviderAvailability} per Novu account: the shared bean for the deployment's own
 * account ({@code null}), and an instance per provisioned tenant organization, so a tenant's
 * snapshot of its integrations never answers for another tenant's.
 */
@Component
public class ProviderAvailabilities {

    private final NovuClient novuClient;
    private final NovuBridgeConfiguration config;
    private final ProviderAvailability shared;
    /** Keyed by root tenant; replaced when the account behind it changes (re-provision, new key). */
    private final Map<String, Entry> byTenant = new ConcurrentHashMap<>();

    /** {@code account} is the instance last asked about, so the same instance skips hashing its key. */
    private record Entry(String cacheKey, NovuAccount account, ProviderAvailability availability) {
    }

    public ProviderAvailabilities(NovuClient novuClient, NovuBridgeConfiguration config, ProviderAvailability shared) {
        this.novuClient = novuClient;
        this.config = config;
        this.shared = shared;
    }

    public ProviderAvailability forAccount(NovuAccount account) {
        if (account == null) {
            return shared;
        }
        // TenantAccountService hands out one NovuAccount instance per read of the tenant's row, so
        // dispatch mostly asks with the instance already stored here, and the key is not hashed again.
        Entry entry = byTenant.compute(account.tenantRoot(), (root, existing) -> {
            if (existing != null && existing.account() == account) {
                return existing;
            }
            String key = account.cacheKey();
            return existing != null && existing.cacheKey().equals(key)
                    ? new Entry(key, account, existing.availability())
                    : new Entry(key, account, new ProviderAvailability(novuClient, config, account));
        });
        return entry.availability();
    }

    /** After a provider write in that account (or the shared one for {@code null}). */
    public void invalidate(NovuAccount account) {
        if (account == null) {
            shared.invalidate();
            return;
        }
        Entry entry = byTenant.get(account.tenantRoot());
        if (entry != null) {
            entry.availability().invalidate();
        }
    }

    /** After a deprovision: the next lookup starts from nothing. */
    public void forget(String tenantRoot) {
        byTenant.remove(tenantRoot);
    }
}
