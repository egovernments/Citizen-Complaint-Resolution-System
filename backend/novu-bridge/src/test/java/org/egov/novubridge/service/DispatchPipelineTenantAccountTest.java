package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.account.NovuAccount;
import org.egov.novubridge.service.account.TenantAccountService;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.DeliveryResult;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.delivery.SmsCountryDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailabilities;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Complaint notifications (#2203, extended scope): a tenant whose root has its own Novu
 * organization is delivered through it; every other tenant through the shared account exactly as
 * before; and an account that cannot be read never silently falls back to the shared one.
 */
class DispatchPipelineTenantAccountTest {

    private static final NovuAccount ACME = new NovuAccount("acme", "org-acme", "env-acme", "key-acme");

    private NovuClient novuClient;
    private DispatchLogRepository ledger;
    private NovuBridgeConfiguration config;
    private TenantAccountService tenantAccounts;
    private SmsCountryDeliveryProvider smsCountry;
    private RestTemplate mdms;
    private DispatchPipelineService service;
    private final Map<String, Object> channelRow = new HashMap<>(Map.of("code", "SMS", "enabled", true, "active", true));

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        novuClient = mock(NovuClient.class);
        ledger = mock(DispatchLogRepository.class);
        PreferenceServiceClient preferences = mock(PreferenceServiceClient.class);
        when(preferences.isChannelAllowed(anyString(), any(), any(), anyString())).thenReturn(true);
        config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of(""));
        config.setSmsProvider("");
        config.setChannelPolicyEnabled(true);
        config.setChannelPolicySchema("NOTIFICATIONS.Channel");
        config.setChannelPolicyCacheTtlMs(60_000L);
        config.setProviderAvailabilityCacheTtlMs(60_000L);
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        mdms = mock(RestTemplate.class);
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenAnswer(inv -> new ResponseEntity(Map.of("mdms", List.of(
                        Map.of("uniqueIdentifier", "SMS", "isActive", true, "data", channelRow))), HttpStatus.OK));

        // The shared account holds a Twilio sender; acme's own organization a Jasmin one.
        when(novuClient.listIntegrations()).thenReturn(NovuClient.NovuResponse.builder().statusCode(200)
                .response(Map.of("data", List.of(Map.of("_id", "s1", "identifier", "twilio-sms-shared",
                        "providerId", "twilio", "channel", "sms", "active", true, "primary", true)))).build());
        when(novuClient.listIntegrations(ACME)).thenReturn(NovuClient.NovuResponse.builder().statusCode(200)
                .response(Map.of("data", List.of(Map.of("_id", "a1", "identifier", "jasmin-acme",
                        "providerId", "jasmin", "channel", "sms", "active", true, "primary", true)))).build());
        NovuClient.NovuResponse accepted = NovuClient.NovuResponse.builder().statusCode(201)
                .response(Map.of("data", Map.of("acknowledged", true, "transactionId", "txn"))).build();
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(),
                any(), any(), any(), any())).thenReturn(accepted);
        when(novuClient.identifyThenTrigger(any(NovuAccount.class), anyString(), any(), anyString(), anyString(), any(),
                anyString(), any(), any(), any(), any())).thenReturn(accepted);

        smsCountry = mock(SmsCountryDeliveryProvider.class);
        when(smsCountry.id()).thenReturn(SmsCountryDeliveryProvider.ID);
        when(smsCountry.supports("SMS")).thenReturn(true);
        when(smsCountry.send(any())).thenReturn(DeliveryResult.accepted(200, "job-1", Map.of()));

        tenantAccounts = mock(TenantAccountService.class);
        when(tenantAccounts.accountFor("acme.city")).thenReturn(ACME);

        ChannelPolicyClient policy = new ChannelPolicyClient(mdms, config);
        DeliveryProviderRegistry registry = new DeliveryProviderRegistry(config, policy,
                new NovuDeliveryProvider(novuClient), smsCountry);
        ProviderAvailability shared = new ProviderAvailability(novuClient, config);
        service = new DispatchPipelineService(new EnvelopeValidator(), preferences, registry, policy, ledger, config, shared);
        service.setTenantAccounts(tenantAccounts, new ProviderAvailabilities(novuClient, config, shared));
    }

    private static NotificationEvent sms(String tenantId) {
        return NotificationEvent.builder()
                .eventId("evt-" + tenantId).eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId(tenantId)
                .channel("SMS").subscriberId(tenantId + ":uuid-123")
                .contact(Contact.builder().userId("uuid-123").type("CITIZEN").phone("+254712345678").locale("en_IN").build())
                .renderedBody("Your complaint PGR-001 was assigned")
                .transactionId("PGR-001:ASSIGN:" + tenantId + ":SMS")
                .build();
    }

    private DispatchLogEntry row() {
        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(ledger).upsert(row.capture());
        return row.getValue();
    }

    @Test
    void aProvisionedTenant_isDeliveredThroughItsOwnOrganization_andTheRowSaysSo() {
        service.process(sms("acme.city"), true, null);

        verify(novuClient).identifyThenTrigger(eq(ACME), eq("acme.city:uuid-123"), any(), eq("SMS"), anyString(),
                any(), anyString(), any(), any(), any(), any());
        verify(novuClient, never()).identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(),
                any(), any(), any(), any());
        DispatchLogEntry row = row();
        assertEquals("SENT", row.getStatus());
        assertEquals("tenant:acme", row.getProviderResponse().get("novuAccount"));
    }

    @Test
    void anUnprovisionedTenant_staysOnTheSharedAccount_exactlyAsBefore() {
        service.process(sms("ke.bomet"), true, null);

        verify(novuClient).identifyThenTrigger(eq("ke.bomet:uuid-123"), any(), eq("SMS"), anyString(), any(),
                anyString(), any(), any(), any(), any());
        verify(novuClient, never()).identifyThenTrigger(any(NovuAccount.class), anyString(), any(), anyString(),
                anyString(), any(), anyString(), any(), any(), any(), any());
        DispatchLogEntry row = row();
        assertEquals("SENT", row.getStatus());
        assertFalse(row.getProviderResponse().containsKey("novuAccount"));
    }

    @Test
    void anAccountThatCannotBeRead_failsTheMessage_neverFallsBackToTheSharedAccount() {
        when(tenantAccounts.accountFor("acme.city")).thenThrow(new CustomException("NB_TENANT_ACCOUNT_UNAVAILABLE", "db down"));

        assertThrows(CustomException.class, () -> service.process(sms("acme.city"), true, null));

        DispatchLogEntry row = row();
        assertEquals("FAILED", row.getStatus());
        assertEquals("NB_TENANT_ACCOUNT_UNAVAILABLE", row.getLastErrorCode());
        verify(novuClient, never()).identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(),
                any(), any(), any(), any());
    }

    @Test
    void aPinIsCheckedAgainstTheTenantsOwnIntegrations_notTheSharedOnes() {
        // twilio-sms-shared exists, but in the SHARED account: for acme it is missing.
        channelRow.put("provider", "twilio-sms-shared");

        service.process(sms("acme.city"), true, null);

        DispatchLogEntry row = row();
        assertEquals("SKIPPED", row.getStatus());
        assertEquals("NB_PROVIDER_UNAVAILABLE", row.getLastErrorCode());
        verify(novuClient, never()).identifyThenTrigger(any(NovuAccount.class), anyString(), any(), anyString(),
                anyString(), any(), anyString(), any(), any(), any(), any());
    }

    @Test
    void theDeploymentsDirectGateway_neverCarriesATenantAccountsMessage() {
        channelRow.put("gateway", "smscountry");

        service.process(sms("acme.city"), true, null);
        verify(smsCountry, never()).send(any());
        verify(novuClient).identifyThenTrigger(eq(ACME), anyString(), any(), eq("SMS"), anyString(), any(), anyString(),
                any(), any(), any(), any());
    }
}
