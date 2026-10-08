package org.egov.novubridge.web.controllers;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.TwilioTemplateSyncService;
import org.egov.novubridge.service.account.AccountException;
import org.egov.novubridge.service.account.NovuAccount;
import org.egov.novubridge.service.account.TenantAccountService;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailabilities;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.egov.novubridge.web.models.IntegrationListResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Configurator screens on a workspace with its own Novu organization (#2203, extended scope): the
 * workspace's admin adds, rotates, deletes and lists providers in THAT organization, and nothing
 * touches the shared account.
 */
class ProviderControllerTenantAccountTest {

    private static final NovuAccount ACME = new NovuAccount("acme", "org-acme", "env-acme", "key-acme");

    private NovuClient novuClient;
    private TenantAccountService tenantAccounts;
    private RestTemplate mdms;
    private ProviderController controller;
    private final List<Map<String, Object>> acmeIntegrations = new ArrayList<>();

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        novuClient = mock(NovuClient.class);
        mdms = mock(RestTemplate.class);
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(Map.of("mdms", List.of()), HttpStatus.OK));
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setChannelPolicyEnabled(true);
        config.setChannelPolicySchema("NOTIFICATIONS.Channel");
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        config.setChannelsEnabled(List.of(""));
        config.setSmsProvider("");
        config.setCoreSmsDefaultTenant("pg");
        tenantAccounts = mock(TenantAccountService.class);
        when(tenantAccounts.enabled()).thenReturn(true);
        when(tenantAccounts.isProvisioned("acme")).thenReturn(true);
        when(tenantAccounts.accountFor("acme")).thenReturn(ACME);
        when(novuClient.listIntegrations(ACME)).thenAnswer(inv -> NovuClient.NovuResponse.builder().statusCode(200)
                .response(Map.of("data", acmeIntegrations)).build());
        when(novuClient.createIntegration(eq(ACME), anyString(), anyString(), anyString(), anyString(), anyMap(), anyBoolean()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("data",
                        Map.of("_id", "new", "identifier", "jasmin-x", "providerId", "jasmin", "channel", "sms",
                                "active", true, "credentials", Map.of("password", "s3cret")))).build());
        when(novuClient.updateIntegration(eq(ACME), anyString(), nullable(String.class), nullable(Map.class), nullable(Boolean.class)))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(200).response(Map.of("data", Map.of("_id", "j1"))).build());

        ChannelPolicyClient policy = new ChannelPolicyClient(mdms, config);
        ProviderAvailability shared = new ProviderAvailability(novuClient, config);
        controller = new ProviderController(novuClient,
                new DeliveryProviderRegistry(config, policy, new NovuDeliveryProvider(novuClient), null),
                mock(DispatchLogRepository.class), mock(TwilioTemplateSyncService.class),
                new ProviderCatalog(config), policy, shared);
        controller.setTenantAccounts(tenantAccounts, new ProviderAvailabilities(novuClient, config, shared));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void request(String selector, String callerTenant) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (selector != null) {
            request.setParameter("tenantId", selector);
        }
        request.setAttribute(ProxyAuthFilter.CALLER_ATTRIBUTE, new ProxyAuthFilter.Caller(
                Set.of("ACCOUNT_ADMIN", "EMPLOYEE"), Set.of(callerTenant), Set.of(callerTenant)));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static Map<String, Object> jasmin() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", "jasmin");
        body.put("name", "Acme gateway");
        body.put("credentials", Map.of("baseUrl", "http://gw-acme:1401/send", "user", "acme", "password", "s3cret",
                "from", "ACME"));
        return body;
    }

    @Test
    void create_landsInTheWorkspacesOwnOrganization_andNeverEchoesCredentials() {
        request("acme", "acme");

        ResponseEntity<?> response = controller.createProvider(jasmin());

        verify(novuClient).createIntegration(eq(ACME), eq("Acme gateway"), anyString(), eq("jasmin"), eq("sms"), anyMap(), eq(true));
        verify(novuClient, never()).createIntegration(anyString(), anyString(), anyString(), anyString(), anyMap(), anyBoolean());
        assertEquals(false, String.valueOf(response.getBody()).contains("s3cret"));
    }

    @Test
    void aWorkspaceAdminOfAnotherRoot_isRefused_evenWithTheSelector() {
        request("acme", "globex");

        AccountException e = assertThrows(AccountException.class, () -> controller.createProvider(jasmin()));

        assertEquals("NB_TENANT_NOT_ALLOWED", e.code());
        verify(novuClient, never()).createIntegration(any(NovuAccount.class), anyString(), anyString(), anyString(),
                anyString(), anyMap(), anyBoolean());
    }

    @Test
    void withoutASelector_theSharedAccountIsUsedExactlyAsBefore() {
        request(null, "pg");
        when(novuClient.createIntegration(anyString(), anyString(), anyString(), anyString(), anyMap(), anyBoolean()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("data", Map.of("_id", "s"))).build());

        controller.createProvider(jasmin());

        verify(novuClient).createIntegration(eq("Acme gateway"), anyString(), eq("jasmin"), eq("sms"), anyMap(), eq(true));
        verify(novuClient, never()).createIntegration(any(NovuAccount.class), anyString(), anyString(), anyString(),
                anyString(), anyMap(), anyBoolean());
    }

    @Test
    void deleting_theLastActiveSmsProviderOfAWorkspaceThatSendsSms_isRefusedForThatWorkspace() {
        request("acme", "acme");
        acmeIntegrations.add(new LinkedHashMap<>(Map.of("_id", "j1", "identifier", "jasmin-a", "providerId", "jasmin",
                "channel", "sms", "active", true)));
        // acme's own channel rows: SMS on, nothing pinned.
        rows(Map.of("code", "SMS", "enabled", true, "active", true));

        ProviderController.Refusal refusal = assertThrows(ProviderController.Refusal.class,
                () -> controller.deleteProvider(new LinkedHashMap<>(Map.of("id", "j1"))));

        assertEquals("NB_PROVIDER_IN_USE", refusal.code());
        assertEquals(true, refusal.getMessage().contains("acme:SMS"), refusal.getMessage());
        verify(novuClient, never()).deleteIntegration(any(NovuAccount.class), anyString());
    }

    @Test
    void aBodyTenantOfAnotherRoot_isRefusedAsAMismatch() {
        request("acme", "acme");
        acmeIntegrations.add(new LinkedHashMap<>(Map.of("_id", "j1", "identifier", "jasmin-a", "providerId", "jasmin",
                "channel", "sms", "active", false)));

        ProviderController.Refusal refusal = assertThrows(ProviderController.Refusal.class,
                () -> controller.deleteProvider(new LinkedHashMap<>(Map.of("id", "j1", "tenantId", "ke"))));

        assertEquals("NB_TENANT_MISMATCH", refusal.code());
    }

    @Test
    void deleting_anUnusedProvider_deletesItInTheWorkspacesOrganization() {
        request("acme", "acme");
        acmeIntegrations.add(new LinkedHashMap<>(Map.of("_id", "j1", "identifier", "jasmin-a", "providerId", "jasmin",
                "channel", "sms", "active", false)));

        controller.deleteProvider(new LinkedHashMap<>(Map.of("id", "j1")));

        verify(novuClient).deleteIntegration(ACME, "j1");
        verify(novuClient, never()).deleteIntegration(anyString());
    }

    @Test
    void theIntegrationList_saysWhoseAccountItShows() {
        request("acme", "acme");
        acmeIntegrations.add(new LinkedHashMap<>(Map.of("_id", "j1", "identifier", "jasmin-a", "providerId", "jasmin",
                "channel", "sms", "active", true, "credentials", Map.of("password", "s3cret"))));
        IntegrationController integrations = new IntegrationController(novuClient);
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setCoreSmsDefaultTenant("pg");
        integrations.setTenantAccounts(tenantAccounts, config);

        IntegrationListResponse body = integrations.integrations().getBody();

        assertEquals(1, body.getData().size());
        assertEquals(false, body.getData().toString().contains("s3cret"));
        assertEquals("TENANT", body.getAccount().get("mode"));
        assertEquals("acme", body.getAccount().get("tenantId"));
        assertEquals(true, body.getAccount().get("manageable"));
    }

    @Test
    void testSend_goesThroughTheWorkspacesOrganization_andTwoWorkspacesNeverShareALedgerRow() {
        NovuAccount globex = new NovuAccount("globex", "org-globex", "env-globex", "key-globex");
        when(tenantAccounts.isProvisioned("globex")).thenReturn(true);
        when(tenantAccounts.accountFor("globex")).thenReturn(globex);
        // Each organization has an SMS provider of its own: the test-send gate reads that organization.
        acmeIntegrations.add(new LinkedHashMap<>(Map.of("_id", "a1", "identifier", "twilio-sms-acme", "providerId", "twilio",
                "channel", "sms", "active", true)));
        when(novuClient.listIntegrations(globex)).thenReturn(NovuClient.NovuResponse.builder().statusCode(200)
                .response(Map.of("data", List.of(Map.of("_id", "g1", "identifier", "twilio-sms-globex", "providerId", "twilio",
                        "channel", "sms", "active", true)))).build());
        when(novuClient.trigger(any(NovuAccount.class), anyString(), anyString(), any(), any(), anyMap(), anyString(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("data", Map.of())).build());
        Map<String, Object> body = new LinkedHashMap<>(Map.of("channel", "SMS", "to", Map.of("phone", "+254700000000"), "body", "t"));

        request("acme", "acme");
        Object acmeTxn = controller.testSend(body).getBody().get("transactionId");
        request("globex", "globex");
        Object globexTxn = controller.testSend(body).getBody().get("transactionId");

        verify(novuClient).trigger(eq(ACME), eq("complaints-sms"), anyString(), eq("+254700000000"), any(), anyMap(), anyString(), any());
        verify(novuClient).trigger(eq(globex), eq("complaints-sms"), anyString(), eq("+254700000000"), any(), anyMap(), anyString(), any());
        verify(novuClient, never()).trigger(anyString(), anyString(), any(), any(), anyMap(), anyString(), any());
        org.junit.jupiter.api.Assertions.assertNotEquals(acmeTxn, globexTxn);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void rows(Map<String, Object> data) {
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(Map.of("mdms", List.of(Map.of("uniqueIdentifier", data.get("code"),
                        "isActive", true, "data", data))), HttpStatus.OK));
    }
}
