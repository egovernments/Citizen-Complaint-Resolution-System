package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.delivery.SmsCountryDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
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

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** The tenant's MDMS channel policy — not the process-wide env — decides gate 2 and the gateway. */
class DispatchPipelineChannelPolicyTest {

    private RestTemplate mdms;
    private NovuClient novuClient;
    private SmsCountryClient smsCountryClient;
    private DispatchLogRepository dispatchLogRepository;
    private DispatchPipelineService service;

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        mdms = mock(RestTemplate.class);
        novuClient = mock(NovuClient.class);
        smsCountryClient = mock(SmsCountryClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        PreferenceServiceClient preferences = mock(PreferenceServiceClient.class);
        when(preferences.isChannelAllowed(anyString(), any(), any(), anyString())).thenReturn(true);

        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of(""));           // env: nothing enabled
        config.setSmsProvider("");                        // env: Novu
        config.setChannelPolicyEnabled(true);
        config.setChannelPolicySchema("RAINMAKER-PGR.NotificationChannel");
        config.setChannelPolicyCacheTtlMs(60_000L);
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");

        // ke: WHATSAPP on via Novu; SMS on via SMSCountry with a tenant sender id.
        Map<String, Object> wa = new HashMap<>(Map.of("code", "WHATSAPP", "enabled", true, "gateway", "novu", "active", true));
        Map<String, Object> sms = new HashMap<>(Map.of("code", "SMS", "enabled", true, "gateway", "smscountry", "senderId", "KE-GOV", "active", true));
        Map<String, Object> body = Map.of("mdms", List.of(
                Map.of("uniqueIdentifier", "WHATSAPP", "isActive", true, "data", wa),
                Map.of("uniqueIdentifier", "SMS", "isActive", true, "data", sms)));
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(body, HttpStatus.OK));

        ChannelPolicyClient policy = new ChannelPolicyClient(mdms, config);
        DeliveryProviderRegistry registry = new DeliveryProviderRegistry(config, policy,
                new NovuDeliveryProvider(novuClient, config), new SmsCountryDeliveryProvider(smsCountryClient, policy));
        service = new DispatchPipelineService(new EnvelopeValidator(), preferences, registry, policy, dispatchLogRepository, config,
                new ProviderAvailability(novuClient, config));
    }

    private ComplaintsDomainEvent event(String channel, String templateId) {
        return ComplaintsDomainEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel(channel).subscriberId("ke.bomet:uuid-123")
                .contact(Contact.builder().userId("uuid-123").type("CITIZEN").phone("+254712345678").email("j@x.org").locale("en_IN").build())
                .renderedBody("body").templateId(templateId)
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:" + channel)
                .build();
    }

    private static NovuClient.NovuResponse ok() {
        NovuClient.NovuResponse r = new NovuClient.NovuResponse(); r.setStatusCode(201); r.setResponse(Map.of("acknowledged", true)); return r;
    }

    @Test
    void whatsappEnabledByTenantPolicy_isDelivered_evenThoughEnvEnablesNothing() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any(), any(), any())).thenReturn(ok());
        service.process(event("WHATSAPP", "HX1234567890abcdef1234567890abcdef"), true, null);
        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(row.capture());
        assertEquals("SENT", row.getValue().getStatus());
    }

    @Test
    void emailWithNoPolicyRow_isSkipped_notEnvLeaked() {
        service.process(event("EMAIL", null), true, null);
        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(row.capture());
        assertEquals("SKIPPED", row.getValue().getStatus());
        assertEquals("NB_NO_PROVIDER", row.getValue().getLastErrorCode());
        verifyNoInteractions(novuClient);
    }

    @Test
    void smsGatewayFromPolicy_usesSmsCountry_withTheTenantSenderId() {
        NovuClient.NovuResponse queued = new NovuClient.NovuResponse(); queued.setStatusCode(200); queued.setResponse(Map.of("jobId", "9", "accepted", true));
        when(smsCountryClient.send(anyString(), anyString(), anyString(), eq("KE-GOV"))).thenReturn(queued);
        service.process(event("SMS", null), true, null);
        verify(smsCountryClient).send(eq("+254712345678"), eq("body"), anyString(), eq("KE-GOV"));
        verifyNoInteractions(novuClient);
    }
}
