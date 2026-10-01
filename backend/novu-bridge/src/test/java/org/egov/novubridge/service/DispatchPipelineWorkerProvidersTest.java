package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.NotificationEvent;
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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A channel pinned to SMSCountry / Ozeki / Jasmin on a deployment whose worker does not load
 * DIGIT's providers: Novu would accept the trigger and drop the message, so the row must say so
 * instead of reading SENT.
 */
class DispatchPipelineWorkerProvidersTest {

    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private NovuBridgeConfiguration config;
    private DispatchPipelineService service;
    private RestTemplate mdms;

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        mdms = mock(RestTemplate.class);
        novuClient = mock(NovuClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
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

        Map<String, Object> sms = new HashMap<>(Map.of("code", "SMS", "enabled", true, "active", true,
                "provider", "smscountry-0011aabbccddeeff"));
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(Map.of("mdms", List.of(
                        Map.of("uniqueIdentifier", "SMS", "isActive", true, "data", sms))), HttpStatus.OK));
        Map<String, Object> integration = Map.of("_id", "i1", "identifier", "smscountry-0011aabbccddeeff",
                "providerId", "smscountry", "channel", "sms", "active", true);
        NovuClient.NovuResponse list = new NovuClient.NovuResponse();
        list.setStatusCode(200);
        list.setResponse(Map.of("data", List.of(integration)));
        when(novuClient.listIntegrations()).thenReturn(list);
        NovuClient.NovuResponse ok = new NovuClient.NovuResponse();
        ok.setStatusCode(201);
        ok.setResponse(Map.of("acknowledged", true));
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(),
                any(), any(), any(), any())).thenReturn(ok);

        ChannelPolicyClient policy = new ChannelPolicyClient(mdms, config);
        DeliveryProviderRegistry registry = new DeliveryProviderRegistry(config, policy,
                new NovuDeliveryProvider(novuClient), null);
        service = new DispatchPipelineService(new EnvelopeValidator(), preferences, registry, policy,
                dispatchLogRepository, config, new ProviderAvailability(novuClient, config));
    }

    private static NotificationEvent sms() {
        return NotificationEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel("SMS").subscriberId("ke.bomet:uuid-123")
                .contact(Contact.builder().userId("uuid-123").type("CITIZEN").phone("+254712345678")
                        .locale("en_IN").build())
                .renderedBody("body")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS")
                .build();
    }

    private DispatchLogEntry row() {
        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(row.capture());
        return row.getValue();
    }

    @Test
    void withTheWorkerProvidersOff_aPinnedSmsCountryChannel_isSkippedVisibly_notSent() {
        config.setDigitWorkerProviders(false);

        service.process(sms(), true, null);

        DispatchLogEntry row = row();
        assertEquals("SKIPPED", row.getStatus());
        assertEquals("NB_PROVIDER_UNAVAILABLE", row.getLastErrorCode());
        assertTrue(row.getLastErrorMessage().contains("NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false"),
                row.getLastErrorMessage());
        verify(novuClient, never()).identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(),
                anyString(), any(), any(), any(), any());
    }

    @Test
    void withTheWorkerProvidersOn_theSameChannelIsDelivered() {
        service.process(sms(), true, null);

        assertEquals("SENT", row().getStatus());
    }

    /** The same SMS channel with no provider selected: a legacy row, sent through Novu's default. */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private void unpinnedSmsRow() {
        Map<String, Object> sms = new HashMap<>(Map.of("code", "SMS", "enabled", true, "active", true));
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(Map.of("mdms", List.of(
                        Map.of("uniqueIdentifier", "SMS", "isActive", true, "data", sms))), HttpStatus.OK));
    }

    // Review (9): the only active Novu sms integration is the leftover SMSCountry one.
    @Test
    void withTheWorkerProvidersOff_anUnpinnedChannelOnAWorkerProviderDefault_isSkippedVisiblyToo() {
        config.setDigitWorkerProviders(false);
        unpinnedSmsRow();

        service.process(sms(), true, null);

        DispatchLogEntry row = row();
        assertEquals("SKIPPED", row.getStatus());
        assertEquals("NB_PROVIDER_UNAVAILABLE", row.getLastErrorCode());
        assertTrue(row.getLastErrorMessage().contains("no provider selected"), row.getLastErrorMessage());
        verify(novuClient, never()).identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(),
                anyString(), any(), any(), any(), any());
    }

    @Test
    void withTheWorkerProvidersOn_theUnpinnedChannelIsDelivered_withoutListingNovu() {
        unpinnedSmsRow();

        service.process(sms(), true, null);

        assertEquals("SENT", row().getStatus());
        verify(novuClient, never()).listIntegrations();
    }
}
