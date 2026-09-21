package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.delivery.SmsCountryDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@code NotificationChannel.provider} — the ONE integration the tenant chose for a channel —
 * decides where a dispatch goes, and pins the Novu trigger to it.
 *
 * <p>The other half of this test matters more: with {@code provider} blank, nothing changes.
 * Deployed tenants (bomet) have no such field, and the catalog must not move them.
 */
class DispatchPipelineProviderTargetingTest {

    private final RestTemplate mdms = mock(RestTemplate.class);
    private final NovuClient novuClient = mock(NovuClient.class);
    private final SmsCountryClient smsCountryClient = mock(SmsCountryClient.class);
    private final DispatchLogRepository dispatchLogRepository = mock(DispatchLogRepository.class);

    @SuppressWarnings({"unchecked", "rawtypes"})
    private DispatchPipelineService pipelineWith(Map<String, Object>... rows) {
        PreferenceServiceClient preferences = mock(PreferenceServiceClient.class);
        when(preferences.isChannelAllowed(anyString(), any(), any(), anyString())).thenReturn(true);

        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of(""));
        config.setSmsProvider("");
        config.setChannelPolicyEnabled(true);
        config.setChannelPolicySchema("RAINMAKER-PGR.NotificationChannel");
        config.setChannelPolicyCacheTtlMs(60_000L);
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");

        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(Map.of("mdms", List.of(rows)), HttpStatus.OK));

        // Every provider these rows name exists in Novu and is active, so the availability gate
        // is exercised for real here rather than stubbed out: the targeting assertions below
        // only hold if a pinned-and-usable provider still reaches the trigger.
        when(novuClient.listIntegrations()).thenReturn(integrationsFor(rows));

        ChannelPolicyClient policy = new ChannelPolicyClient(mdms, config);
        DeliveryProviderRegistry registry = new DeliveryProviderRegistry(config, policy,
                new NovuDeliveryProvider(novuClient, config),
                new SmsCountryDeliveryProvider(smsCountryClient, policy));
        return new DispatchPipelineService(new EnvelopeValidator(), preferences, registry, policy,
                dispatchLogRepository, config, new ProviderAvailability(novuClient, config));
    }

    /** A Novu {@code GET /v1/integrations} body carrying every provider the rows pin, active. */
    @SuppressWarnings("unchecked")
    private static NovuClient.NovuResponse integrationsFor(Map<String, Object>... rows) {
        List<Map<String, Object>> integrations = new java.util.ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> data = (Map<String, Object>) row.get("data");
            Object provider = data.get("provider");
            if (provider == null) {
                continue;
            }
            integrations.add(Map.of(
                    "_id", "novu-" + provider,
                    "identifier", provider.toString(),
                    "active", true,
                    "channel", "EMAIL".equals(data.get("code")) ? "email" : "sms"));
        }
        NovuClient.NovuResponse r = new NovuClient.NovuResponse();
        r.setStatusCode(200);
        r.setResponse(Map.of("data", integrations));
        return r;
    }

    private static Map<String, Object> row(String code, String gateway, String provider) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", code);
        data.put("enabled", true);
        data.put("active", true);
        if (gateway != null) data.put("gateway", gateway);
        if (provider != null) data.put("provider", provider);
        return Map.of("uniqueIdentifier", code, "isActive", true, "data", data);
    }

    private static NotificationEvent event(String channel) {
        return NotificationEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel(channel).subscriberId("ke.bomet:uuid-123")
                .contact(Contact.builder().userId("uuid-123").type("CITIZEN")
                        .phone("+254712345678").email("j@x.org").locale("en_IN").build())
                .renderedBody("body")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:" + channel)
                .build();
    }

    private static NovuClient.NovuResponse ok() {
        NovuClient.NovuResponse r = new NovuClient.NovuResponse();
        r.setStatusCode(201);
        r.setResponse(new HashMap<>(Map.of("acknowledged", true, "transactionId", "novu-txn-1")));
        return r;
    }

    // ---- provider set ----------------------------------------------------

    @Test
    void chosenProviderIsPassedToNovuAsTheIntegrationToTarget() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), nullable(String.class),
                anyString(), any(), nullable(String.class), any(), anyString(), nullable(String.class)))
                .thenReturn(ok());

        pipelineWith(row("SMS", null, "twilio-sms-abcdef01")).process(event("SMS"), true, null);

        ArgumentCaptor<String> identifier = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> type = ArgumentCaptor.forClass(String.class);
        verify(novuClient).identifyThenTrigger(anyString(), any(), eq("SMS"), anyString(),
                nullable(String.class), anyString(), any(), nullable(String.class), any(),
                identifier.capture(), type.capture());
        assertEquals("twilio-sms-abcdef01", identifier.getValue());
        // The type comes from the identifier's own prefix — no extra Novu round trip.
        assertEquals("twilio-sms", type.getValue());
    }

    @Test
    void anOzekiProviderCarriesItsCatalogTypeSoTheGatewayBodyCanBeAttached() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), nullable(String.class),
                anyString(), any(), nullable(String.class), any(), anyString(), nullable(String.class)))
                .thenReturn(ok());

        pipelineWith(row("SMS", null, "ozeki-0011aabb")).process(event("SMS"), true, null);

        ArgumentCaptor<String> type = ArgumentCaptor.forClass(String.class);
        verify(novuClient).identifyThenTrigger(anyString(), any(), anyString(), anyString(),
                nullable(String.class), anyString(), any(), nullable(String.class), any(),
                eq("ozeki-0011aabb"), type.capture());
        assertEquals("ozeki", type.getValue());
    }

    @Test
    void aChosenProviderOutranksTheGatewayField_soTheDirectRouteIsNotTaken() {
        // gateway=smscountry is the pre-catalog "bypass Novu" switch. An SMSCountry provider
        // configured in the configurator is a Novu integration pointing back at our adapter,
        // so naming one must send the dispatch through Novu, not the direct client.
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), nullable(String.class),
                anyString(), any(), nullable(String.class), any(), anyString(), nullable(String.class)))
                .thenReturn(ok());

        pipelineWith(row("SMS", "smscountry", "smscountry-99887766")).process(event("SMS"), true, null);

        verifyNoInteractions(smsCountryClient);
        verify(novuClient).identifyThenTrigger(anyString(), any(), anyString(), anyString(),
                nullable(String.class), anyString(), any(), nullable(String.class), any(),
                eq("smscountry-99887766"), eq("smscountry"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void theDispatchLogRowRecordsWhichIntegrationCarriedTheMessage() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), nullable(String.class),
                anyString(), any(), nullable(String.class), any(), anyString(), nullable(String.class)))
                .thenReturn(ok());

        pipelineWith(row("SMS", null, "twilio-sms-abcdef01")).process(event("SMS"), true, null);

        ArgumentCaptor<DispatchLogEntry> logged = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(logged.capture());
        DispatchLogEntry entry = logged.getValue();
        assertEquals("SENT", entry.getStatus());
        assertEquals("twilio-sms-abcdef01", entry.getProviderResponse().get("integrationIdentifier"),
                "without this, a per-tenant provider switch is invisible after the fact");
    }

    @Test
    void emailPinsTheEmailChannelOverride() {
        Map<String, Object> overrides =
                NovuClient.applyIntegrationOverride(null, "EMAIL", "smtp-deadbeef");
        assertEquals(Map.of("integrationIdentifier", "smtp-deadbeef"), overrides.get("email"));

        // WhatsApp rides Novu's sms channel, so it pins under sms.
        Map<String, Object> wa = NovuClient.applyIntegrationOverride(null, "WHATSAPP", "twilio-whatsapp-aa");
        assertEquals(Map.of("integrationIdentifier", "twilio-whatsapp-aa"), wa.get("sms"));
    }

    @Test
    void theOzekiGatewayBodyIsKeyedByTheNovuProviderId_notTheGatewayName() {
        Map<String, Object> overrides = NovuClient.applyGatewayBody(
                NovuClient.applyIntegrationOverride(null, "SMS", "ozeki-1"),
                "ozeki", "txn-9", "+254712345678", "hello");

        @SuppressWarnings("unchecked")
        Map<String, Object> providers = (Map<String, Object>) overrides.get("providers");
        // Novu looks up overrides.providers[integration.providerId]; a key of "ozeki" is dropped.
        assertTrue(providers.containsKey("generic-sms"));
        @SuppressWarnings("unchecked")
        Map<String, Object> passthrough = (Map<String, Object>) ((Map<String, Object>)
                providers.get("generic-sms")).get("_passthrough");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> messages = (List<Map<String, Object>>)
                ((Map<String, Object>) passthrough.get("body")).get("messages");
        assertEquals("txn-9", messages.get(0).get("message_id"));
        assertEquals("+254712345678", messages.get(0).get("to_address"));
        assertEquals("hello", messages.get(0).get("text"));
        // The integration pin survives alongside it.
        assertEquals(Map.of("integrationIdentifier", "ozeki-1"), overrides.get("sms"));
    }

    @Test
    void smsCountryNeedsNoGatewayBody_novuTalksToTheAdapterInPlainGenericSmsJson() {
        assertEquals(null, NovuClient.applyGatewayBody(null, "smscountry", "t", "+1", "x"));
        assertEquals(null, NovuClient.applyGatewayBody(null, "twilio-sms", "t", "+1", "x"));
        assertEquals(null, NovuClient.applyGatewayBody(null, null, "t", "+1", "x"));
    }

    // ---- provider blank: unchanged ---------------------------------------

    @Test
    void withNoProviderChosen_theOriginalTriggerOverloadIsUsed_unchanged() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), nullable(String.class),
                anyString(), any(), nullable(String.class), any())).thenReturn(ok());

        pipelineWith(row("SMS", null, null)).process(event("SMS"), true, null);

        verify(novuClient).identifyThenTrigger(anyString(), any(), eq("SMS"), anyString(),
                nullable(String.class), anyString(), any(), nullable(String.class), any());
        verify(novuClient, never()).identifyThenTrigger(anyString(), any(), anyString(), anyString(),
                nullable(String.class), anyString(), any(), nullable(String.class), any(),
                anyString(), nullable(String.class));
    }

    @Test
    void withNoProviderChosen_theGatewayFieldStillRoutesToTheDirectClient() {
        NovuClient.NovuResponse queued = new NovuClient.NovuResponse();
        queued.setStatusCode(200);
        queued.setResponse(Map.of("jobId", "9", "accepted", true));
        when(smsCountryClient.send(anyString(), anyString(), anyString(), nullable(String.class)))
                .thenReturn(queued);

        pipelineWith(row("SMS", "smscountry", null)).process(event("SMS"), true, null);

        verify(smsCountryClient).send(eq("+254712345678"), eq("body"), anyString(), nullable(String.class));
        verifyNoInteractions(novuClient);
    }

    @Test
    @SuppressWarnings("unchecked")
    void withNoProviderChosen_theLogRowCarriesNoIntegrationIdentifier() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), nullable(String.class),
                anyString(), any(), nullable(String.class), any())).thenReturn(ok());

        pipelineWith(row("SMS", null, null)).process(event("SMS"), true, null);

        ArgumentCaptor<DispatchLogEntry> logged = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(logged.capture());
        assertTrue(!logged.getValue().getProviderResponse().containsKey("integrationIdentifier"));
    }
}
