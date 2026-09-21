package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchResult;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * A channel that names a provider Novu cannot deliver through must NOT report SENT.
 *
 * <p>Novu accepts a trigger naming a deleted, disabled or wrong-channel integration and fails
 * the step internally ({@code SUBSCRIBER_NO_ACTIVE_INTEGRATION}), which the bridge never sees:
 * the operator reads {@code SENT} on the Logs screen for a message nobody received. These tests
 * pin the opposite — {@code SKIPPED / NB_PROVIDER_UNAVAILABLE}, with the identifier and the
 * reason in the row — and pin that the gate never blocks when it simply cannot see.
 */
class DispatchPipelineProviderAvailabilityTest {

    private final RestTemplate mdms = mock(RestTemplate.class);
    private final NovuClient novuClient = mock(NovuClient.class);
    private final DispatchLogRepository dispatchLogRepository = mock(DispatchLogRepository.class);

    /** A pipeline whose one channel row pins {@code provider}, over the given Novu integrations. */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private DispatchPipelineService pipeline(String channelCode, String provider,
                                             List<Map<String, Object>> integrations) {
        PreferenceServiceClient preferences = mock(PreferenceServiceClient.class);
        when(preferences.isChannelAllowed(anyString(), any(), any(), anyString())).thenReturn(true);

        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of(""));
        config.setSmsProvider("");
        config.setChannelPolicyEnabled(true);
        config.setChannelPolicySchema("RAINMAKER-PGR.NotificationChannel");
        config.setChannelPolicyCacheTtlMs(60_000L);
        config.setProviderAvailabilityCacheTtlMs(60_000L);
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", channelCode);
        data.put("enabled", true);
        data.put("active", true);
        if (provider != null) {
            data.put("provider", provider);
        }
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(Map.of("mdms",
                        List.of(Map.of("uniqueIdentifier", channelCode, "isActive", true, "data", data))),
                        HttpStatus.OK));

        if (integrations != null) {
            NovuClient.NovuResponse listed = new NovuClient.NovuResponse();
            listed.setStatusCode(200);
            listed.setResponse(Map.of("data", integrations));
            when(novuClient.listIntegrations()).thenReturn(listed);
        }

        ChannelPolicyClient policy = new ChannelPolicyClient(mdms, config);
        DeliveryProviderRegistry registry = new DeliveryProviderRegistry(config, policy,
                new NovuDeliveryProvider(novuClient, config), null);
        return new DispatchPipelineService(new EnvelopeValidator(), preferences, registry, policy,
                dispatchLogRepository, config, new ProviderAvailability(novuClient, config));
    }

    private static Map<String, Object> integration(String identifier, boolean active, String novuChannel) {
        return Map.of("_id", "novu-" + identifier, "identifier", identifier,
                "active", active, "channel", novuChannel);
    }

    private static ComplaintsDomainEvent event(String channel) {
        return ComplaintsDomainEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel(channel).subscriberId("ke.bomet:uuid-123")
                .contact(Contact.builder().userId("uuid-123").type("CITIZEN")
                        .phone("+254712345678").email("j@x.org").locale("en_IN").build())
                .renderedBody("body").templateId("HX123")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:" + channel)
                .build();
    }

    private DispatchLogEntry onlyLoggedRow() {
        ArgumentCaptor<DispatchLogEntry> logged = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(logged.capture());
        return logged.getValue();
    }

    // ---- the three unusable shapes ---------------------------------------

    @Test
    void aProviderThatNoLongerExistsInNovu_isSkipped_notReportedSent() {
        DispatchResult result = pipeline("SMS", "twilio-sms-gone", List.of(
                integration("twilio-sms-other", true, "sms")))
                .process(event("SMS"), true, null);

        DispatchLogEntry row = onlyLoggedRow();
        assertEquals("SKIPPED", row.getStatus());
        assertEquals("NB_PROVIDER_UNAVAILABLE", row.getLastErrorCode());
        assertTrue(row.getLastErrorMessage().contains("twilio-sms-gone"),
                "the row must name the identifier the operator selected: " + row.getLastErrorMessage());
        assertTrue(row.getLastErrorMessage().contains("missing"),
                "and say it is missing rather than merely unusable: " + row.getLastErrorMessage());
        assertFalse(result.getNovuTriggered());
        // Novu was asked for its integration list and NOTHING else: no trigger went out.
        verify(novuClient).listIntegrations();
        verifyNoMoreInteractions(novuClient);
    }

    @Test
    void aDisabledProvider_isSkipped_notReportedSent() {
        pipeline("SMS", "twilio-sms-off", List.of(integration("twilio-sms-off", false, "sms")))
                .process(event("SMS"), true, null);

        DispatchLogEntry row = onlyLoggedRow();
        assertEquals("SKIPPED", row.getStatus());
        assertEquals("NB_PROVIDER_UNAVAILABLE", row.getLastErrorCode());
        assertTrue(row.getLastErrorMessage().contains("twilio-sms-off"), row.getLastErrorMessage());
        assertTrue(row.getLastErrorMessage().contains("disabled"),
                "an integration that exists but is off must say so, not 'missing': "
                        + row.getLastErrorMessage());
        verify(novuClient).listIntegrations();
        verifyNoMoreInteractions(novuClient);
    }

    @Test
    void aProviderOnTheWrongNovuChannel_isSkipped() {
        // An SMTP integration selected for SMS: Novu would accept the trigger and never send.
        pipeline("SMS", "smtp-deadbeef", List.of(integration("smtp-deadbeef", true, "email")))
                .process(event("SMS"), true, null);

        DispatchLogEntry row = onlyLoggedRow();
        assertEquals("SKIPPED", row.getStatus());
        assertEquals("NB_PROVIDER_UNAVAILABLE", row.getLastErrorCode());
        assertTrue(row.getLastErrorMessage().contains("email"), row.getLastErrorMessage());
        verify(novuClient).listIntegrations();
        verifyNoMoreInteractions(novuClient);
    }

    @Test
    void whatsappRidesTheSmsChannel_soATwilioWhatsappIntegrationIsNoMismatch() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(),
                nullable(String.class), anyString(), any(), nullable(String.class), any(),
                anyString(), nullable(String.class)))
                .thenReturn(accepted());

        pipeline("WHATSAPP", "twilio-whatsapp-aa11", List.of(
                integration("twilio-whatsapp-aa11", true, "sms")))
                .process(event("WHATSAPP"), true, null);

        assertEquals("SENT", onlyLoggedRow().getStatus());
    }

    // ---- fail open --------------------------------------------------------

    @Test
    void whenNovuCannotBeListed_deliveryIsNotBlocked() {
        // Same posture as the consent gate: an outage of the CHECK must never become an
        // outage of the DELIVERY. The trigger goes out exactly as it did before this gate.
        when(novuClient.listIntegrations())
                .thenThrow(new CustomException("NB_NOVU_INTEGRATIONS_FAILED", "connection refused"));
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(),
                nullable(String.class), anyString(), any(), nullable(String.class), any(),
                anyString(), nullable(String.class)))
                .thenReturn(accepted());

        DispatchResult result = pipeline("SMS", "twilio-sms-abcdef01", null)
                .process(event("SMS"), true, null);

        assertTrue(result.getNovuTriggered());
        DispatchLogEntry row = onlyLoggedRow();
        assertEquals("SENT", row.getStatus());
        assertNull(row.getLastErrorCode());
        verify(novuClient).identifyThenTrigger(anyString(), any(), eq("SMS"), anyString(),
                nullable(String.class), anyString(), any(), nullable(String.class), any(),
                eq("twilio-sms-abcdef01"), nullable(String.class));
    }

    // ---- the pre-catalog path is untouched --------------------------------

    @Test
    void withNoProviderChosen_novuIsNeverAskedForItsIntegrations() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(),
                nullable(String.class), anyString(), any(), nullable(String.class), any()))
                .thenReturn(accepted());

        pipeline("SMS", null, null).process(event("SMS"), true, null);

        assertEquals("SENT", onlyLoggedRow().getStatus());
        // Not one extra call on the Kafka listener thread for tenants that never picked a
        // provider — which is every deployed tenant today.
        verify(novuClient, org.mockito.Mockito.never()).listIntegrations();
    }

    private static NovuClient.NovuResponse accepted() {
        NovuClient.NovuResponse r = new NovuClient.NovuResponse();
        r.setStatusCode(201);
        r.setResponse(Map.of("acknowledged", true, "transactionId", "novu-txn-1"));
        return r;
    }
}
