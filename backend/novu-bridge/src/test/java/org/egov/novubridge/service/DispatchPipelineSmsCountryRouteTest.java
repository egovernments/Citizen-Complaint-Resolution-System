package org.egov.novubridge.service;

import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.delivery.SmsCountryDeliveryProvider;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * With {@code novu.bridge.sms.provider=smscountry}, the SMS leg goes to the direct gateway and
 * the dispatch log records the gateway's verdict under the gateway's code. Novu is never
 * touched for that leg. (Before the provider seam this row said "Novu returned status 502".)
 */
class DispatchPipelineSmsCountryRouteTest {

    private NovuClient novuClient;
    private SmsCountryClient smsCountryClient;
    private DispatchLogRepository dispatchLogRepository;
    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        smsCountryClient = mock(SmsCountryClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        PreferenceServiceClient preferences = mock(PreferenceServiceClient.class);
        when(preferences.isChannelAllowed(anyString(), any(), any(), anyString())).thenReturn(true);

        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of("SMS", "EMAIL"));
        config.setSmsProvider("smscountry");
        ChannelPolicyClient policy = new ChannelPolicyClient(null, config);

        DeliveryProviderRegistry registry = new DeliveryProviderRegistry(config, policy,
                new NovuDeliveryProvider(novuClient), new SmsCountryDeliveryProvider(smsCountryClient, policy));
        service = new DispatchPipelineService(new EnvelopeValidator(), preferences, registry, policy, dispatchLogRepository, config,
                new ProviderAvailability(novuClient, config));
    }

    private NotificationEvent smsEvent() {
        return NotificationEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel("SMS").subscriberId("ke.bomet:uuid-123")
                .contact(Contact.builder().userId("uuid-123").type("CITIZEN").phone("+254712345678").locale("en_IN").build())
                .renderedBody("Dear Jane, your complaint PGR-001 is assigned.")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS")
                .build();
    }

    private static NovuClient.NovuResponse resp(int status, Map<String, Object> body) {
        NovuClient.NovuResponse r = new NovuClient.NovuResponse();
        r.setStatusCode(status); r.setResponse(body); return r;
    }

    @Test
    void gatewayRejection_isRecordedUnderTheGatewaysCode_notNovus() {
        when(smsCountryClient.send(anyString(), anyString(), anyString(), any()))
                .thenReturn(resp(502, Map.of("error", "NB_SMSCOUNTRY_REJECTED", "message", "Invalid Sender ID")));

        DispatchResult result = service.process(smsEvent(), true, null);
        assertFalse(result.getNovuTriggered());

        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(row.capture());
        assertEquals("FAILED", row.getValue().getStatus());
        assertEquals("NB_SMSCOUNTRY_REJECTED", row.getValue().getLastErrorCode());
        assertEquals("Invalid Sender ID", row.getValue().getLastErrorMessage());
        verifyNoInteractions(novuClient);
    }

    @Test
    void gatewayQueued_isSent_andNovuIsNeverTouched() {
        when(smsCountryClient.send(eq("+254712345678"), anyString(), anyString(), any()))
                .thenReturn(resp(200, Map.of("jobId", "123", "accepted", true)));

        DispatchResult result = service.process(smsEvent(), true, null);
        assertTrue(result.getNovuTriggered());

        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(row.capture());
        assertEquals("SENT", row.getValue().getStatus());
        assertEquals("123", row.getValue().getProviderResponse().get("jobId"));
        verifyNoInteractions(novuClient);
    }
}
