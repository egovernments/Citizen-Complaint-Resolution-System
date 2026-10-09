package org.egov.novubridge.service.account;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.provider.ProviderAvailabilities;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Provisioning gives a root tenant exactly ONE Novu organization, whatever fails or is retried,
 * and routing fails closed. Each test names the property it pins.
 */
class TenantAccountServiceTest {

    static final String SECRET = "0123456789abcdef0123456789abcdef-tenant-keys";

    private FakeTenantAccountRepository repository;
    private NovuPlatformClient platform;
    private NovuClient novuClient;
    private TenantAccountsConfiguration accounts;
    private TenantAccountService service;
    private final List<String> novuOrganizations = new ArrayList<>();

    @BeforeEach
    void setUp() {
        repository = new FakeTenantAccountRepository();
        platform = mock(NovuPlatformClient.class);
        novuClient = mock(NovuClient.class);
        accounts = accountsConfig();
        NovuBridgeConfiguration config = bridgeConfig();

        when(platform.login()).thenReturn("jwt-admin");
        when(platform.organizations("jwt-admin")).thenAnswer(inv -> novuOrganizations.stream()
                .map(name -> new NovuPlatformClient.Organization("org-" + name.substring(name.lastIndexOf(' ') + 1), name))
                .toList());
        when(platform.createOrganization(eq("jwt-admin"), anyString())).thenAnswer(inv -> {
            String name = inv.getArgument(1);
            novuOrganizations.add(name);
            return new NovuPlatformClient.Organization("org-" + name.substring(name.lastIndexOf(' ') + 1), name);
        });
        when(platform.switchOrganization(eq("jwt-admin"), anyString()))
                .thenAnswer(inv -> "jwt-" + inv.getArgument(1));
        when(platform.environments(anyString())).thenAnswer(inv -> {
            String org = ((String) inv.getArgument(0)).substring("jwt-".length());
            return List.of(new NovuPlatformClient.Environment("env-dev-" + org, "Development", "key-dev-" + org),
                    new NovuPlatformClient.Environment("env-prod-" + org, "Production", "key-prod-" + org));
        });
        when(novuClient.listWorkflows(any(NovuAccount.class))).thenReturn(response(200, Map.of("data", Map.of("workflows", List.of()))));
        when(novuClient.createWorkflow(any(NovuAccount.class), any())).thenReturn(response(201, Map.of("data", Map.of())));
        when(novuClient.listIntegrations(any(NovuAccount.class))).thenReturn(response(200, Map.of("data", List.of(
                Map.of("_id", "i-inapp", "providerId", "novu", "channel", "in_app", "active", true),
                Map.of("_id", "i-sms", "identifier", "jasmin-aa", "providerId", "jasmin", "channel", "sms", "active", true)))));

        ProviderAvailabilities availabilities = new ProviderAvailabilities(novuClient, config,
                new ProviderAvailability(novuClient, config));
        service = new TenantAccountService(accounts, repository, platform, novuClient,
                new TenantWorkflows(novuClient, config, accounts), availabilities);
    }

    static TenantAccountsConfiguration accountsConfig() {
        TenantAccountsConfiguration accounts = new TenantAccountsConfiguration();
        accounts.setEnabled(true);
        accounts.setAdminEmail("admin@example.test");
        accounts.setAdminPassword("Platform-Admin-1");
        accounts.setEncryptionKey(SECRET);
        accounts.setEnvironmentName("Development");
        accounts.setOrganizationPrefix("DIGIT tenant ");
        accounts.setCacheTtlMs(0L);
        accounts.setLeaseMs(120_000L);
        accounts.setOtpWorkflowSms("digit-otp-sms");
        accounts.setOtpWorkflowEmail("digit-otp-email");
        return accounts;
    }

    static NovuBridgeConfiguration bridgeConfig() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setNovuWorkflowSms("complaints-sms");
        config.setNovuWorkflowWhatsapp("complaints-whatsapp");
        config.setNovuWorkflowEmail("complaints-email");
        config.setProviderAvailabilityCacheTtlMs(60_000L);
        return config;
    }

    static NovuClient.NovuResponse response(int status, Map<String, Object> body) {
        return NovuClient.NovuResponse.builder().statusCode(status).response(body).build();
    }

    @Test
    void provision_createsOneOrganization_recordsItFirst_ensuresEveryWorkflow_andStoresTheKeyEncrypted() {
        TenantAccountService.ProvisionResult result = service.provision("acme.city");

        assertTrue(result.organizationCreated());
        assertEquals("PROVISIONED", result.state().get("status"));
        assertEquals("acme", result.state().get("tenantId"));
        assertEquals("org-acme", result.state().get("organizationId"));
        assertEquals("env-dev-org-acme", result.state().get("environmentId"));
        assertEquals(List.of("complaints-sms", "complaints-whatsapp", "complaints-email", "digit-otp-sms",
                "digit-otp-email"), result.workflowsCreated());
        TenantAccountRepository.Row row = repository.rows.get("acme");
        assertFalse(row.apiKeyCiphertext().contains("key-dev"), "the key must never be stored in clear");
        assertFalse(result.state().toString().contains("key-dev"), "the state view must never carry the key");
        assertEquals("key-dev-org-acme", new ApiKeyCipher(SECRET, null).decrypt(row.apiKeyCiphertext(), "acme"));
        // The organization id is written before anything that could fail after Novu created it.
        InOrder order = inOrder(platform);
        order.verify(platform).createOrganization("jwt-admin", "DIGIT tenant acme");
        order.verify(platform).switchOrganization("jwt-admin", "org-acme");
    }

    @Test
    void provision_isIdempotent_aSecondCallChangesNothingAndCallsNoNovu() {
        service.provision("acme");
        TenantAccountService.ProvisionResult again = service.provision("acme");

        assertFalse(again.organizationCreated());
        assertEquals("PROVISIONED", again.state().get("status"));
        verify(platform, times(1)).createOrganization(anyString(), anyString());
        verify(platform, times(1)).login();
        assertEquals(1, novuOrganizations.size());
    }

    @Test
    void aRetryAfterAFailureFollowingOrgCreation_reusesTheRecordedOrganization() {
        doThrow(new AccountException(HttpStatus.BAD_GATEWAY, "NB_NOVU_PLATFORM_FAILED", "boom"))
                .doAnswer(inv -> List.of(new NovuPlatformClient.Environment("env-dev", "Development", "key-dev")))
                .when(platform).environments(anyString());

        AccountException first = assertThrows(AccountException.class, () -> service.provision("acme"));
        assertEquals("NB_NOVU_PLATFORM_FAILED", first.code());
        assertEquals("FAILED", repository.rows.get("acme").status());
        assertEquals("org-acme", repository.rows.get("acme").organizationId());
        assertNull(repository.rows.get("acme").leaseOwner(), "a failure releases the lease");

        TenantAccountService.ProvisionResult retry = service.provision("acme");
        assertFalse(retry.organizationCreated());
        assertEquals("PROVISIONED", retry.state().get("status"));
        verify(platform, times(1)).createOrganization(anyString(), anyString());
    }

    @Test
    void aCrashBetweenNovuCreatingTheOrgAndTheRowRecordingIt_isRecoveredByName_notDuplicated() {
        // Novu has the organization already (a previous replica created it, then died).
        novuOrganizations.add("DIGIT tenant acme");

        TenantAccountService.ProvisionResult result = service.provision("acme");

        assertFalse(result.organizationCreated());
        assertEquals("org-acme", result.state().get("organizationId"));
        verify(platform, never()).createOrganization(anyString(), anyString());
    }

    @Test
    void aConcurrentProvision_isRefusedWhileAnotherHoldsTheLease() {
        repository.claim("acme", "another-replica", System.currentTimeMillis(), System.currentTimeMillis() + 60_000);

        AccountException e = assertThrows(AccountException.class, () -> service.provision("acme"));

        assertEquals("NB_PROVISIONING_IN_PROGRESS", e.code());
        assertEquals(HttpStatus.CONFLICT, e.status());
        verify(platform, never()).createOrganization(anyString(), anyString());
    }

    @Test
    void aStaleWorkflowSet_isReEnsuredOnTheNextProvision() {
        service.provision("acme");
        repository.rows.put("acme", repository.rows.get("acme").toBuilder().workflowsVersion(0).build());

        service.provision("acme");

        verify(novuClient, times(2)).listWorkflows(any(NovuAccount.class));
        assertEquals(TenantWorkflows.VERSION, repository.rows.get("acme").workflowsVersion());
    }

    @Test
    void duringAnEncryptionKeyRotation_aReProvisionStoresTheKeyUnderTheNewKey() {
        service.provision("acme");
        String writtenBefore = repository.rows.get("acme").apiKeyCiphertext();
        accounts.setPreviousEncryptionKey(SECRET);
        accounts.setEncryptionKey("fedcba9876543210fedcba9876543210-rotated-key");
        TenantAccountService rotated = new TenantAccountService(accounts, repository, platform, novuClient,
                new TenantWorkflows(novuClient, bridgeConfig(), accounts), mock(ProviderAvailabilities.class));
        assertEquals("key-dev-org-acme", rotated.accountFor("acme").apiKey(), "the previous key still reads it");

        rotated.provision("acme");

        String writtenAfter = repository.rows.get("acme").apiKeyCiphertext();
        assertFalse(writtenAfter.equals(writtenBefore));
        assertEquals("key-dev-org-acme", new ApiKeyCipher(accounts.getEncryptionKey(), null).decrypt(writtenAfter, "acme"));
        verify(platform, times(1)).createOrganization(anyString(), anyString());
        // Once stored under the new key, a provision is a no-op again.
        rotated.provision("acme");
        verify(platform, times(2)).login();
    }

    @Test
    void routing_aProvisionedRootAnswersItsOwnAccount_forEveryTenantUnderIt() {
        service.provision("acme");

        NovuAccount account = service.accountFor("acme.north");

        assertNotNull(account);
        assertEquals("acme", account.tenantRoot());
        assertEquals("key-dev-org-acme", account.apiKey());
        assertFalse(account.toString().contains("key-dev"), "toString must never print the key");
    }

    @Test
    void routing_anUnprovisionedTenant_staysOnTheSharedAccount() {
        assertNull(service.accountFor("globex.city"));
        assertFalse(service.isProvisioned("globex"));
    }

    @Test
    void routing_withTheFeatureOff_everyTenantStaysOnTheSharedAccount() {
        service.provision("acme");
        accounts.setEnabled(false);

        assertNull(service.accountFor("acme"));
        assertFalse(service.isProvisioned("acme"));
    }

    @Test
    void routing_failsClosed_whenTheRowCannotBeRead() {
        service.provision("acme");
        repository.failFind = true;

        CustomException e = assertThrows(CustomException.class, () -> service.accountFor("acme"));
        assertEquals("NB_TENANT_ACCOUNT_UNAVAILABLE", e.getCode());
    }

    @Test
    void routing_failsClosed_whenTheStoredKeyDoesNotDecrypt() {
        service.provision("acme");
        accounts.setEncryptionKey("ffffffffffffffffffffffffffffffff-another-key");
        TenantAccountService fresh = new TenantAccountService(accounts, repository, platform, novuClient,
                mock(TenantWorkflows.class), mock(ProviderAvailabilities.class));

        CustomException e = assertThrows(CustomException.class, () -> fresh.accountFor("acme"));
        assertEquals("NB_TENANT_ACCOUNT_UNAVAILABLE", e.getCode());
    }

    @Test
    void deprovision_deletesTheTenantsIntegrations_regeneratesTheKey_andFallsBackToShared() {
        service.provision("acme");

        Map<String, Object> state = service.deprovision("acme");

        assertEquals("DEPROVISIONED", state.get("status"));
        assertEquals(false, state.get("apiKeyStored"));
        ArgumentCaptor<String> deleted = ArgumentCaptor.forClass(String.class);
        verify(novuClient).deleteIntegration(any(NovuAccount.class), deleted.capture());
        assertEquals(List.of("i-sms"), deleted.getAllValues(), "Novu's built-in in-app integration is left alone");
        verify(platform).regenerateApiKey("jwt-org-acme", "env-dev-org-acme");
        assertNull(service.accountFor("acme"));
    }

    @Test
    void aReProvisionAfterDeprovision_reusesTheSameOrganization() {
        service.provision("acme");
        service.deprovision("acme");

        TenantAccountService.ProvisionResult again = service.provision("acme");

        assertEquals("PROVISIONED", again.state().get("status"));
        assertFalse(again.organizationCreated());
        verify(platform, times(1)).createOrganization(anyString(), anyString());
    }

    @Test
    void provision_refusesWhenTheFeatureIsOff_andForAnInvalidTenant() {
        accounts.setEnabled(false);
        assertEquals("NB_TENANT_ACCOUNTS_DISABLED", assertThrows(AccountException.class,
                () -> service.provision("acme")).code());
        accounts.setEnabled(true);
        assertEquals("NB_INVALID_TENANT", assertThrows(AccountException.class,
                () -> service.provision("Acme Corp")).code());
        assertEquals("NB_INVALID_TENANT", assertThrows(AccountException.class,
                () -> service.provision("../etc")).code());
    }
}
