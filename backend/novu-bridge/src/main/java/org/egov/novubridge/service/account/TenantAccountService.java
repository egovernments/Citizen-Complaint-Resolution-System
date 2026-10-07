package org.egov.novubridge.service.account;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.provider.ProviderAvailabilities;
import org.egov.novubridge.util.Values;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/**
 * Per-tenant Novu accounts (#2203): one Novu ORGANIZATION per root tenant, created and managed by
 * the bridge with the Novu platform admin's login ({@link NovuPlatformClient}).
 *
 * <p><b>Provision</b> is idempotent and safe to retry, from any replica:
 * <ol>
 *   <li>claim a lease on the tenant's row (a concurrent provision of the same tenant gets 409
 *       {@code NB_PROVISIONING_IN_PROGRESS});</li>
 *   <li>reuse the organization the row records; else adopt one the admin already has under the
 *       tenant's organization name (a crash after Novu created it but before the row recorded it);
 *       else create it, and record its id at once. So a tenant never gets a second organization;</li>
 *   <li>switch into it, read the configured environment's API key, create the missing workflows
 *       ({@link TenantWorkflows}), store the key encrypted ({@link ApiKeyCipher}), mark PROVISIONED.</li>
 * </ol>
 * A tenant already PROVISIONED with the current workflow set is a no-op that returns its state.
 *
 * <p><b>Routing</b>: {@link #accountFor} is what dispatch, test-send and the provider screens ask.
 * A PROVISIONED root answers its own account; anything else answers {@code null}, the shared
 * deployment account. It fails CLOSED: when the row cannot be read or the key cannot be decrypted
 * it throws, rather than quietly sending a provisioned tenant's messages through the shared account.
 *
 * <p><b>Deprovision</b>: self-hosted Novu 2.3.0 cannot delete an organization (its organization
 * API has no delete), so the bridge deletes the organization's integrations (and with them the
 * tenant's provider credentials), regenerates the environment's API key without keeping the new
 * one, forgets the stored key and marks the row DEPROVISIONED. The tenant falls back to the shared
 * account; a later provision reuses the same organization.
 */
@Slf4j
@Service
public class TenantAccountService {

    /** A root tenant code: no dot, the characters DIGIT tenant codes use. */
    private static final Pattern ROOT = Pattern.compile("[a-z0-9][a-z0-9_-]{0,63}");

    private final TenantAccountsConfiguration accounts;
    private final TenantAccountRepository repository;
    private final NovuPlatformClient platform;
    private final NovuClient novuClient;
    private final TenantWorkflows workflows;
    private final ProviderAvailabilities availabilities;
    private final String owner = "nb:" + UUID.randomUUID();
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private volatile ApiKeyCipher cipher;
    LongSupplier clock = System::currentTimeMillis;

    private record Cached(Optional<TenantAccountRepository.Row> row, long fetchedAt) {
    }

    /** What provision answers: the tenant's state, and whether this call created the organization. */
    public record ProvisionResult(Map<String, Object> state, boolean organizationCreated, List<String> workflowsCreated) {
    }

    public TenantAccountService(TenantAccountsConfiguration accounts, TenantAccountRepository repository,
                                NovuPlatformClient platform, NovuClient novuClient, TenantWorkflows workflows,
                                ProviderAvailabilities availabilities) {
        this.accounts = accounts;
        this.repository = repository;
        this.platform = platform;
        this.novuClient = novuClient;
        this.workflows = workflows;
        this.availabilities = availabilities;
    }

    public boolean enabled() {
        return accounts.isEnabled();
    }

    /** {@code ke.bomet} to {@code ke}; validated, so it is safe in an organization name and a path. */
    public static String rootOf(String tenantId) {
        if (!StringUtils.hasText(tenantId)) {
            throw new AccountException(HttpStatus.BAD_REQUEST, "NB_INVALID_TENANT", "tenantId is required");
        }
        String trimmed = tenantId.trim().toLowerCase(Locale.ROOT);
        int dot = trimmed.indexOf('.');
        String root = dot < 0 ? trimmed : trimmed.substring(0, dot);
        if (!ROOT.matcher(root).matches()) {
            throw new AccountException(HttpStatus.BAD_REQUEST, "NB_INVALID_TENANT",
                    "tenantId must start with a root tenant code of lower-case letters, digits, '-' or '_'");
        }
        return root;
    }

    // ---------------------------------------------------------------- routing

    /**
     * The Novu account a tenant's messages go through: its root's own when PROVISIONED, else
     * {@code null} (the shared account). Also {@code null} when the feature is off.
     *
     * @throws CustomException {@code NB_TENANT_ACCOUNT_UNAVAILABLE} when the row cannot be read or the
     *                         stored key cannot be decrypted (fail closed)
     */
    public NovuAccount accountFor(String tenantId) {
        if (!enabled() || !StringUtils.hasText(tenantId)) {
            return null;
        }
        String root;
        try {
            root = rootOf(tenantId);
        } catch (AccountException e) {
            return null; // Not a tenant code we could ever have provisioned.
        }
        Optional<TenantAccountRepository.Row> row;
        try {
            row = cachedRow(root);
        } catch (RuntimeException e) {
            throw new CustomException("NB_TENANT_ACCOUNT_UNAVAILABLE", "Could not read whether tenant " + root
                    + " has its own notification account (" + e.getMessage() + "); not sending through the shared one");
        }
        if (row.isEmpty() || !row.get().provisioned()) {
            return null;
        }
        return toAccount(row.get());
    }

    /** True when the root has its own account (cached; never throws: an unreadable row reads false). */
    public boolean isProvisioned(String tenantId) {
        if (!enabled() || !StringUtils.hasText(tenantId)) {
            return false;
        }
        try {
            return cachedRow(rootOf(tenantId)).map(TenantAccountRepository.Row::provisioned).orElse(false);
        } catch (RuntimeException e) {
            log.warn("Tenant account lookup failed for {}: {}", tenantId, e.getMessage());
            return false;
        }
    }

    private NovuAccount toAccount(TenantAccountRepository.Row row) {
        String key;
        try {
            key = cipher().decrypt(row.apiKeyCiphertext(), row.tenantId());
        } catch (IllegalArgumentException e) {
            throw new CustomException("NB_TENANT_ACCOUNT_UNAVAILABLE", "Tenant " + row.tenantId()
                    + "'s notification account key cannot be read: " + e.getMessage());
        }
        return new NovuAccount(row.tenantId(), row.organizationId(), row.environmentId(), key);
    }

    private Optional<TenantAccountRepository.Row> cachedRow(String root) {
        long ttl = accounts.getCacheTtlMs() == null ? 30_000L : accounts.getCacheTtlMs();
        long now = clock.getAsLong();
        Cached cached = cache.get(root);
        if (cached != null && now - cached.fetchedAt() < ttl) {
            return cached.row();
        }
        Optional<TenantAccountRepository.Row> fresh = repository.find(root);
        cache.put(root, new Cached(fresh, now));
        return fresh;
    }

    private void forgetCached(String root) {
        cache.remove(root);
    }

    // ---------------------------------------------------------------- provision

    public ProvisionResult provision(String tenantId) {
        requireEnabled();
        String root = rootOf(tenantId);
        Optional<TenantAccountRepository.Row> before = repository.find(root);
        if (before.isPresent() && before.get().provisioned() && before.get().workflowsVersion() >= TenantWorkflows.VERSION
                && StringUtils.hasText(before.get().apiKeyCiphertext())) {
            return new ProvisionResult(view(before.get()), false, List.of());
        }
        long now = clock.getAsLong();
        if (!repository.claim(root, owner, now, now + leaseMs())) {
            throw new AccountException(HttpStatus.CONFLICT, "NB_PROVISIONING_IN_PROGRESS",
                    "Tenant " + root + " is being provisioned by another request; retry in a few seconds");
        }
        boolean wasProvisioned = before.isPresent() && before.get().provisioned();
        boolean created = false;
        try {
            String token = platform.login();
            String orgName = accounts.organizationName(root);
            String organizationId = repository.find(root).map(TenantAccountRepository.Row::organizationId).orElse(null);
            if (!StringUtils.hasText(organizationId)) {
                organizationId = platform.organizations(token).stream()
                        .filter(o -> orgName.equals(o.name()))
                        .map(NovuPlatformClient.Organization::id)
                        .findFirst().orElse(null);
                if (organizationId != null) {
                    log.info("Tenant {}: adopting existing Novu organization {} ({})", root, organizationId, orgName);
                } else {
                    organizationId = platform.createOrganization(token, orgName).id();
                    created = true;
                }
                // Recorded before anything else can fail: a retry reuses it, never creates another.
                repository.recordOrganization(root, organizationId, orgName, clock.getAsLong());
            }
            String orgToken = platform.switchOrganization(token, organizationId);
            NovuPlatformClient.Environment environment = environment(platform.environments(orgToken), root);
            NovuAccount account = new NovuAccount(root, organizationId, environment.id(), environment.apiKey());
            List<String> workflowsCreated = workflows.ensure(account);
            ApiKeyCipher c = cipher();
            repository.markProvisioned(root, owner, environment.id(), environment.name(),
                    c.encrypt(environment.apiKey(), root), c.currentKeyId(), TenantWorkflows.VERSION, clock.getAsLong());
            forgetCached(root);
            availabilities.forget(root);
            log.info("Tenant {}: Novu account PROVISIONED (organization {}, environment {}, organization created: {}, "
                    + "workflows created: {})", root, organizationId, environment.name(), created, workflowsCreated);
            return new ProvisionResult(view(repository.find(root).orElseThrow()), created, workflowsCreated);
        } catch (AccountException e) {
            fail(root, wasProvisioned, e.code(), e.getMessage());
            throw e;
        } catch (CustomException e) {
            fail(root, wasProvisioned, e.getCode(), e.getMessage());
            throw new AccountException(HttpStatus.BAD_GATEWAY, e.getCode(), e.getMessage(), e);
        } catch (RuntimeException e) {
            fail(root, wasProvisioned, "NB_PROVISIONING_FAILED", e.getMessage());
            throw new AccountException(HttpStatus.INTERNAL_SERVER_ERROR, "NB_PROVISIONING_FAILED",
                    "Provisioning tenant " + root + " failed: " + e.getMessage(), e);
        }
    }

    private void fail(String root, boolean wasProvisioned, String code, String message) {
        // A PROVISIONED tenant whose re-ensure failed keeps sending through its account.
        repository.markFailed(root, owner, wasProvisioned ? TenantAccountRepository.PROVISIONED
                : TenantAccountRepository.FAILED, code, truncate(message), clock.getAsLong());
        forgetCached(root);
        log.warn("Tenant {}: provisioning failed ({}): {}", root, code, message);
    }

    private NovuPlatformClient.Environment environment(List<NovuPlatformClient.Environment> environments, String root) {
        String wanted = accounts.getEnvironmentName();
        for (NovuPlatformClient.Environment env : environments) {
            if (env.name() != null && env.name().equalsIgnoreCase(wanted)) {
                if (!StringUtils.hasText(env.apiKey()) || !StringUtils.hasText(env.id())) {
                    throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_FAILED", "Novu returned the "
                            + wanted + " environment of tenant " + root + " without its API key");
                }
                return env;
            }
        }
        throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_FAILED", "Tenant " + root
                + "'s Novu organization has no '" + wanted + "' environment (novu.bridge.tenant.accounts.environment)");
    }

    // ---------------------------------------------------------------- deprovision

    public Map<String, Object> deprovision(String tenantId) {
        requireEnabled();
        String root = rootOf(tenantId);
        TenantAccountRepository.Row row = repository.find(root).orElseThrow(() -> new AccountException(
                HttpStatus.NOT_FOUND, "NB_TENANT_NOT_PROVISIONED", "Tenant " + root + " has no notification account"));
        if (TenantAccountRepository.DEPROVISIONED.equals(row.status())) {
            return view(row);
        }
        long now = clock.getAsLong();
        if (!repository.claim(root, owner, now, now + leaseMs())) {
            throw new AccountException(HttpStatus.CONFLICT, "NB_PROVISIONING_IN_PROGRESS",
                    "Tenant " + root + " is being changed by another request; retry in a few seconds");
        }
        try {
            if (StringUtils.hasText(row.organizationId())) {
                String orgToken = platform.switchOrganization(platform.login(), row.organizationId());
                NovuPlatformClient.Environment environment = environment(platform.environments(orgToken), root);
                NovuAccount account = new NovuAccount(root, row.organizationId(), environment.id(), environment.apiKey());
                int deleted = deleteIntegrations(account);
                platform.regenerateApiKey(orgToken, environment.id());
                log.info("Tenant {}: deprovisioned (organization {} kept: Novu 2.3.0 cannot delete one; {} "
                        + "integration(s) deleted, API key regenerated and not stored)", root, row.organizationId(), deleted);
            }
            repository.markDeprovisioned(root, owner, clock.getAsLong());
            forgetCached(root);
            availabilities.forget(root);
            return view(repository.find(root).orElseThrow());
        } catch (AccountException e) {
            repository.release(root, owner, clock.getAsLong());
            throw e;
        } catch (RuntimeException e) {
            repository.release(root, owner, clock.getAsLong());
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_DEPROVISIONING_FAILED",
                    "Deprovisioning tenant " + root + " failed: " + e.getMessage(), e);
        }
    }

    /** Every integration but Novu's built-in ones (in-app), which hold no tenant credential. */
    private int deleteIntegrations(NovuAccount account) {
        NovuClient.NovuResponse response = novuClient.listIntegrations(account);
        List<Object> data = Values.asList(response == null || response.getResponse() == null
                ? null : response.getResponse().get("data"));
        if (data == null) {
            throw new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_INTEGRATIONS_FAILED",
                    "Novu listed tenant " + account.tenantRoot() + "'s integrations without a data list");
        }
        int deleted = 0;
        for (Object item : data) {
            Map<String, Object> integration = Values.asMap(item);
            if (integration == null || "novu".equalsIgnoreCase(Values.str(integration.get("providerId")))) {
                continue;
            }
            novuClient.deleteIntegration(account, Values.str(integration.get("_id")));
            deleted++;
        }
        return deleted;
    }

    // ---------------------------------------------------------------- reads

    public Optional<Map<String, Object>> find(String tenantId) {
        return repository.find(rootOf(tenantId)).map(TenantAccountService::view);
    }

    public List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>();
        repository.list().forEach(row -> out.add(view(row)));
        return out;
    }

    /** The account of a PROVISIONED tenant, for the admin API; 404 / 409 otherwise. */
    public NovuAccount requireAccount(String tenantId) {
        requireEnabled();
        String root = rootOf(tenantId);
        TenantAccountRepository.Row row = repository.find(root).orElseThrow(() -> notProvisioned(root));
        if (!row.provisioned() || !StringUtils.hasText(row.apiKeyCiphertext())) {
            throw notProvisioned(root);
        }
        return toAccount(row);
    }

    public static AccountException notProvisioned(String root) {
        return new AccountException(HttpStatus.CONFLICT, "NB_TENANT_NOT_PROVISIONED",
                "Tenant " + root + " has no notification account of its own: provision it first "
                        + "(POST /novu-adapter/v1/tenants/" + root + "/_provision)");
    }

    /** Never the key; the key id says which encryption key wrote it. */
    static Map<String, Object> view(TenantAccountRepository.Row row) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("tenantId", row.tenantId());
        out.put("status", row.status());
        out.put("provisioned", row.provisioned());
        out.put("organizationId", row.organizationId());
        out.put("organizationName", row.organizationName());
        out.put("environmentId", row.environmentId());
        out.put("environmentName", row.environmentName());
        out.put("apiKeyStored", StringUtils.hasText(row.apiKeyCiphertext()));
        out.put("apiKeyEncryptionKeyId", row.apiKeyId());
        out.put("workflowsVersion", row.workflowsVersion());
        out.put("currentWorkflowsVersion", TenantWorkflows.VERSION);
        if (row.lastErrorCode() != null) {
            out.put("lastErrorCode", row.lastErrorCode());
            out.put("lastErrorMessage", row.lastErrorMessage());
        }
        out.put("provisionedTime", row.provisionedTime());
        out.put("deprovisionedTime", row.deprovisionedTime());
        out.put("lastModifiedTime", row.lastModifiedTime());
        return out;
    }

    private void requireEnabled() {
        if (!enabled()) {
            throw new AccountException(HttpStatus.CONFLICT, "NB_TENANT_ACCOUNTS_DISABLED",
                    "Per-tenant notification accounts are off on this deployment (novu.bridge.tenant.accounts.enabled)");
        }
    }

    private ApiKeyCipher cipher() {
        ApiKeyCipher c = cipher;
        if (c == null) {
            try {
                c = new ApiKeyCipher(accounts.getEncryptionKey(), accounts.getPreviousEncryptionKey());
            } catch (IllegalArgumentException e) {
                throw new AccountException(HttpStatus.SERVICE_UNAVAILABLE, "NB_TENANT_ACCOUNTS_MISCONFIGURED",
                        "novu.bridge.tenant.accounts.encryption.key: " + e.getMessage());
            }
            cipher = c;
        }
        return c;
    }

    private long leaseMs() {
        return accounts.getLeaseMs() == null ? 120_000L : accounts.getLeaseMs();
    }

    private static String truncate(String message) {
        if (message == null) {
            return null;
        }
        return message.length() > 1000 ? message.substring(0, 1000) : message;
    }
}
