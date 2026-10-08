package org.egov.novubridge.web.controllers;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.SmsCountryClient;
import org.egov.novubridge.service.TwilioTemplateSyncService;
import org.egov.novubridge.service.account.NovuAccount;
import org.egov.novubridge.service.account.TenantAccountService;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.delivery.SmsCountryDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailabilities;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * #2342's test-send gate on a workspace with its own Novu organization (#2203). A workspace's Test
 * goes through its own organization, so it is judged by THAT organization's integrations, the way
 * its dispatch is: never by the shared account's. Before, the gate read the shared account's list:
 * a Test through the workspace's own provider was refused as missing, and an unpinned one was
 * passed because the shared account had an SMS integration the workspace could not use.
 */
class ProviderControllerWorkspaceTestSendTest {

    private static final NovuAccount ACME = new NovuAccount("acme", "org-acme", "env-acme", "key-acme");

    private NovuClient novuClient;
    private DispatchLogRepository dispatchLog;
    private NovuBridgeConfiguration config;
    private ProviderController controller;
    private ProviderAvailabilities availabilities;
    private final List<Map<String, Object>> acmeIntegrations = new ArrayList<>();
    private final List<Map<String, Object>> sharedIntegrations = new ArrayList<>();

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        dispatchLog = mock(DispatchLogRepository.class);
        config = new NovuBridgeConfiguration();
        config.setProviderAvailabilityCacheTtlMs(60_000L);
        config.setSmsProvider("");
        config.setCoreSmsDefaultTenant("pg");
        TenantAccountService tenantAccounts = mock(TenantAccountService.class);
        when(tenantAccounts.enabled()).thenReturn(true);
        when(tenantAccounts.isProvisioned("acme")).thenReturn(true);
        when(tenantAccounts.accountFor("acme")).thenReturn(ACME);
        when(novuClient.listIntegrations()).thenAnswer(inv -> NovuClient.NovuResponse.builder().statusCode(200)
                .response(Map.of("data", new ArrayList<>(sharedIntegrations))).build());
        when(novuClient.listIntegrations(ACME)).thenAnswer(inv -> NovuClient.NovuResponse.builder().statusCode(200)
                .response(Map.of("data", new ArrayList<>(acmeIntegrations))).build());
        when(novuClient.applyWhatsappIntegrationOverride(nullable(Map.class), anyString()))
                .thenAnswer(inv -> inv.getArgument(0));
        when(novuClient.trigger(any(NovuAccount.class), anyString(), anyString(), nullable(String.class),
                nullable(String.class), anyMap(), anyString(), nullable(Map.class)))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201)
                        .response(Map.of("data", Map.of("acknowledged", true))).build());
        when(novuClient.trigger(anyString(), anyString(), nullable(String.class), nullable(String.class),
                anyMap(), anyString(), nullable(Map.class)))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201)
                        .response(Map.of("data", Map.of("acknowledged", true))).build());

        this.tenantAccounts = tenantAccounts;
        shared = new ProviderAvailability(novuClient, config);
        availabilities = new ProviderAvailabilities(novuClient, config, shared);
        controller = controller(null);
    }

    private TenantAccountService tenantAccounts;
    private ProviderAvailability shared;

    /** @param smsCountry wired = the deployment's legacy direct SMS gateway exists */
    private ProviderController controller(SmsCountryDeliveryProvider smsCountry) {
        ChannelPolicyClient policy = new ChannelPolicyClient(null, config);
        ProviderController c = new ProviderController(novuClient,
                new DeliveryProviderRegistry(config, policy, new NovuDeliveryProvider(novuClient), smsCountry),
                dispatchLog, mock(TwilioTemplateSyncService.class), new ProviderCatalog(config), policy, shared);
        c.setTenantAccounts(tenantAccounts, availabilities);
        return c;
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    /** A Configurator request: {@code ?tenantId=<selector>} by an admin of {@code callerTenant}. */
    private static void request(String selector, String callerTenant) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (selector != null) {
            request.setParameter("tenantId", selector);
        }
        request.setAttribute(ProxyAuthFilter.CALLER_ATTRIBUTE, new ProxyAuthFilter.Caller(
                Set.of("ACCOUNT_ADMIN", "EMPLOYEE"), Set.of(callerTenant), Set.of(callerTenant)));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static Map<String, Object> integration(List<Map<String, Object>> account, String id, String identifier,
                                                   String providerId, String channel, boolean active) {
        Map<String, Object> i = new LinkedHashMap<>();
        i.put("_id", id);
        i.put("identifier", identifier);
        i.put("providerId", providerId);
        i.put("channel", channel);
        i.put("active", active);
        account.add(i);
        return i;
    }

    private static Map<String, Object> sms(String id) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (id != null) {
            body.put("id", id);
        }
        body.put("channel", "SMS");
        body.put("to", Map.of("phone", "+254712345678"));
        body.put("body", "hello");
        return body;
    }

    private void assertRefused(Map<String, Object> body, String... inMessage) {
        ProviderController.Refusal refusal = assertThrows(ProviderController.Refusal.class,
                () -> controller.testSend(body));
        assertEquals(HttpStatus.CONFLICT, refusal.status());
        assertEquals("NB_PROVIDER_UNAVAILABLE", refusal.code());
        assertTrue(refusal.getMessage().contains("Nothing was sent"), refusal.getMessage());
        for (String s : inMessage) {
            assertTrue(refusal.getMessage().contains(s), refusal.getMessage());
        }
        assertNothingSent();
    }

    private void assertNothingSent() {
        verify(novuClient, never()).trigger(any(NovuAccount.class), any(), any(), any(), any(), any(), any(), any());
        verify(novuClient, never()).trigger(anyString(), any(), any(), any(), any(), any(), any());
        verify(dispatchLog, never()).upsert(any());
    }

    // ---- a provider named: the workspace's own ---------------------------------------------

    @Test
    void workspaceNamedProvider_available_triggersThroughTheWorkspaceOrganization() {
        request("acme", "acme");
        integration(acmeIntegrations, "a1", "twilio-sms-acme", "twilio", "sms", true);
        // The shared account has no such integration: it must not be asked.

        Map<String, Object> out = controller.testSend(sms("a1")).getBody();

        assertEquals(true, out.get("ok"));
        assertFalse(out.containsKey("warning"), String.valueOf(out));
        verify(novuClient).trigger(eq(ACME), eq("complaints-sms"), anyString(), eq("+254712345678"),
                nullable(String.class), anyMap(), anyString(),
                eq(Map.of("sms", Map.of("integrationIdentifier", "twilio-sms-acme"))));
        verify(novuClient, never()).trigger(anyString(), any(), any(), any(), any(), any(), any());
        verify(novuClient, never()).listIntegrations();
        verify(dispatchLog).upsert(any(DispatchLogEntry.class));
    }

    @Test
    void workspaceNamedProvider_missingByTheCheck_isRefused_evenThoughTheSharedAccountHasIt() {
        request("acme", "acme");
        Map<String, Object> listed = integration(acmeIntegrations, "a1", "twilio-sms-acme", "twilio", "sms", true);
        integration(sharedIntegrations, "s1", "twilio-sms-acme", "twilio", "sms", true);
        // The lookup sees it in the workspace's organization; by the availability read it is gone there.
        when(novuClient.listIntegrations(ACME))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(200)
                        .response(Map.of("data", List.of(listed))).build())
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(200)
                        .response(Map.of("data", List.of())).build());

        assertRefused(sms("a1"), "twilio-sms-acme", "is missing");
    }

    @Test
    void workspaceNamedProvider_inactive_isRefused_evenThoughTheSharedAccountsNamesakeIsActive() {
        request("acme", "acme");
        integration(acmeIntegrations, "a1", "twilio-sms-acme", "twilio", "sms", false);
        integration(sharedIntegrations, "s1", "twilio-sms-acme", "twilio", "sms", true);

        assertRefused(sms("a1"), "twilio-sms-acme", "disabled");
    }

    @Test
    void workspaceNamedProvider_onAnotherChannel_isRefused() {
        request("acme", "acme");
        integration(acmeIntegrations, "a1", "smtp-acme", "nodemailer", "email", true);
        integration(sharedIntegrations, "s1", "smtp-acme", "twilio", "sms", true);

        assertRefused(sms("a1"), "'email' integration", "SMS");
    }

    @Test
    void aSharedAccountProvider_namedInAWorkspaceTest_isNotFoundThere_andNothingIsSentAnywhere() {
        request("acme", "acme");
        integration(sharedIntegrations, "s1", "twilio-sms-shared", "twilio", "sms", true);

        CustomException e = assertThrows(CustomException.class, () -> controller.testSend(sms("twilio-sms-shared")));

        assertEquals("NB_PROVIDER_NOT_FOUND", e.getCode());
        assertNothingSent();
    }

    // ---- no provider named: the workspace organization's own default --------------------

    @Test
    void workspaceUnpinned_withNoActiveIntegrationInItsOrganization_isRefused_evenIfTheSharedAccountHasOne() {
        request("acme", "acme");
        integration(acmeIntegrations, "a1", "twilio-sms-acme", "twilio", "sms", false);
        integration(sharedIntegrations, "s1", "twilio-sms-shared", "twilio", "sms", true);

        assertRefused(sms(null), "SMS has no provider selected", "no active integration");
    }

    @Test
    void workspaceUnpinned_isCheckedThroughNovu_evenWhenTheSharedSmsGoesToTheDirectGateway() {
        // The deployment sends SMS straight to SMSCountry; a workspace never does (its own credentials).
        config.setSmsProvider("smscountry");
        config.setSmsCountryUrl("http://api.smscountry.com/SMSCwebservice_bulk.aspx");
        SmsCountryClient smsCountry = mock(SmsCountryClient.class);
        controller = controller(new SmsCountryDeliveryProvider(smsCountry, new ChannelPolicyClient(null, config)));
        request("acme", "acme");

        assertRefused(sms(null), "SMS has no provider selected");
        verify(smsCountry, never()).send(any(), any(), any(), any());
    }

    @Test
    void workspaceUnpinned_withAnActiveIntegrationInItsOrganization_triggersThroughIt() {
        request("acme", "acme");
        integration(acmeIntegrations, "a1", "twilio-sms-acme", "twilio", "sms", true);

        Map<String, Object> out = controller.testSend(sms(null)).getBody();

        assertEquals(true, out.get("ok"));
        assertFalse(out.containsKey("warning"), String.valueOf(out));
        verify(novuClient).trigger(eq(ACME), eq("complaints-sms"), anyString(), eq("+254712345678"),
                nullable(String.class), anyMap(), anyString(), nullable(Map.class));
        verify(novuClient, never()).listIntegrations();
    }

    @Test
    void workspaceTest_readsItsOrganizationFresh_notTheSnapshotItsDispatchCached() {
        request("acme", "acme");
        Map<String, Object> a1 = integration(acmeIntegrations, "a1", "twilio-sms-acme", "twilio", "sms", true);
        assertTrue(availabilities.forAccount(ACME).checkUnpinned("SMS").usable());   // dispatch cached it active
        a1.put("active", false);                                                     // then disabled in Novu

        assertRefused(sms(null), "no active integration");
    }

    @Test
    void workspaceTest_whenItsOrganizationCannotBeListed_isSentWithAWarning() {
        request("acme", "acme");
        when(novuClient.listIntegrations(ACME)).thenThrow(new IllegalStateException("connection refused"));
        integration(sharedIntegrations, "s1", "twilio-sms-shared", "twilio", "sms", true);

        Map<String, Object> out = controller.testSend(sms(null)).getBody();

        assertEquals(true, out.get("ok"));
        assertTrue(String.valueOf(out.get("warning")).contains("could not be listed"), String.valueOf(out));
        verify(novuClient).trigger(eq(ACME), eq("complaints-sms"), anyString(), eq("+254712345678"),
                nullable(String.class), anyMap(), anyString(), nullable(Map.class));
    }

    // ---- the shared account: #2342's behaviour, unchanged --------------------------------

    @Test
    void sharedAccount_isStillJudgedByItsOwnList_notByAWorkspaces() {
        request(null, "pg");
        integration(acmeIntegrations, "a1", "twilio-sms-acme", "twilio", "sms", true);

        assertRefused(sms(null), "SMS has no provider selected", "no active integration");
        verify(novuClient, never()).listIntegrations(ACME);
    }

    @Test
    void sharedAccount_withAnActiveIntegration_triggersThroughTheSharedAccount() {
        request(null, "pg");
        integration(sharedIntegrations, "s1", "twilio-sms-shared", "twilio", "sms", true);

        Map<String, Object> out = controller.testSend(sms("s1")).getBody();

        assertEquals(true, out.get("ok"));
        assertFalse(out.containsKey("warning"), String.valueOf(out));
        verify(novuClient).trigger(eq("complaints-sms"), anyString(), eq("+254712345678"), nullable(String.class),
                anyMap(), anyString(), eq(Map.of("sms", Map.of("integrationIdentifier", "twilio-sms-shared"))));
        verify(novuClient, never()).trigger(any(NovuAccount.class), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void sharedAccount_namedInactive_isStillRefused() {
        request(null, "pg");
        integration(sharedIntegrations, "s1", "twilio-sms-shared", "twilio", "sms", false);

        assertRefused(sms("s1"), "twilio-sms-shared", "disabled");
    }
}
