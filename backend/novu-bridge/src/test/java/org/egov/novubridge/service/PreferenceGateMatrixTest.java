package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
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
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * NB-6: the channel-preference consent gate ({@link PreferenceServiceClient#isChannelAllowed}).
 * Real client, mocked {@link RestTemplate}. The matrix: gate-off short-circuits
 * without consulting the service; enabled + GRANTED allows; enabled + any
 * missing/non-GRANTED consent denies; a blank userId denies; and an unreachable
 * service FAILS CLOSED (denies).
 *
 * <p>Note on the two defaults: the Java {@code @Value} default for
 * {@code novu.bridge.preference.enabled} is {@code true}, while the compose file
 * ships it {@code false}. Here the flag is set explicitly per test; the fail-closed
 * posture below is the rollout decision to flip if the team ever chooses fail-open.
 */
class PreferenceGateMatrixTest {

    private RestTemplate restTemplate;
    private NovuBridgeConfiguration config;
    private PreferenceServiceClient client;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setPreferenceEnabled(true);
        config.setPreferenceHost("http://preference");
        config.setPreferenceCheckPath("/v1/_search");
        config.setPreferenceCode("USER_NOTIFICATION_PREFERENCES");
        client = new PreferenceServiceClient(restTemplate, config);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void stubResponse(Map<String, Object> body) {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(body, HttpStatus.OK));
    }

    private Map<String, Object> consentBody(String channelKey, String status) {
        Map<String, Object> channelConsent = new HashMap<>();
        if (status != null) {
            channelConsent.put("status", status);
        }
        Map<String, Object> consent = new HashMap<>();
        consent.put(channelKey, channelConsent);
        Map<String, Object> payload = new HashMap<>();
        payload.put("consent", consent);
        Map<String, Object> pref = new HashMap<>();
        pref.put("payload", payload);
        Map<String, Object> body = new HashMap<>();
        body.put("preferences", List.of(pref));
        return body;
    }

    @Test
    void gateOff_allowsWithoutConsultingService() {
        config.setPreferenceEnabled(false);
        assertTrue(client.isChannelAllowed("ke.bomet", "uuid-1", "+254712345678", "SMS"));
        verify(restTemplate, never())
                .exchange(anyString(), any(HttpMethod.class), any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void gateOn_grantedConsent_allows() {
        stubResponse(consentBody("SMS", "GRANTED"));
        assertTrue(client.isChannelAllowed("ke.bomet", "uuid-1", "+254712345678", "SMS"));
    }

    @Test
    void gateOn_grantedConsent_isCaseInsensitiveOnStatus() {
        stubResponse(consentBody("SMS", "granted"));
        assertTrue(client.isChannelAllowed("ke.bomet", "uuid-1", "+254712345678", "SMS"));
    }

    @Test
    void gateOn_emptyPreferences_denies() {
        Map<String, Object> body = new HashMap<>();
        body.put("preferences", List.of());
        stubResponse(body);
        assertFalse(client.isChannelAllowed("ke.bomet", "uuid-1", "+254712345678", "SMS"));
    }

    @Test
    void gateOn_nullPayload_denies() {
        Map<String, Object> pref = new HashMap<>();
        pref.put("payload", null);
        Map<String, Object> body = new HashMap<>();
        body.put("preferences", List.of(pref));
        stubResponse(body);
        assertFalse(client.isChannelAllowed("ke.bomet", "uuid-1", "+254712345678", "SMS"));
    }

    @Test
    void gateOn_channelConsentMissing_denies() {
        // consent block exists but has no entry for the requested channel (SMS).
        stubResponse(consentBody("EMAIL", "GRANTED"));
        assertFalse(client.isChannelAllowed("ke.bomet", "uuid-1", "+254712345678", "SMS"));
    }

    @Test
    void gateOn_statusNotGranted_denies() {
        stubResponse(consentBody("SMS", "REVOKED"));
        assertFalse(client.isChannelAllowed("ke.bomet", "uuid-1", "+254712345678", "SMS"));
    }

    @Test
    void gateOn_serviceUnreachable_failsClosed() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new ResourceAccessException("connection timed out"));
        assertFalse(client.isChannelAllowed("ke.bomet", "uuid-1", "+254712345678", "SMS"));
    }

    @Test
    void gateOn_blankUserId_denies_withoutConsultingService() {
        assertFalse(client.isChannelAllowed("ke.bomet", "   ", "+254712345678", "SMS"));
        verify(restTemplate, never())
                .exchange(anyString(), any(HttpMethod.class), any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void pipeline_preferenceDenied_persistsSkippedRow_withPreferenceDeniedCode() {
        // The existing pass-through test asserts the SKIP outcome but not the log row's
        // status/code — pin those here through the real pipeline.
        PreferenceServiceClient denying = mock(PreferenceServiceClient.class);
        when(denying.isChannelAllowed(anyString(), any(), any(), anyString())).thenReturn(false);
        NovuClient novuClient = mock(NovuClient.class);
        DispatchLogRepository dispatchLogRepository = mock(DispatchLogRepository.class);
        NovuBridgeConfiguration pipelineConfig = new NovuBridgeConfiguration();
        pipelineConfig.setChannel("SMS");
        pipelineConfig.setDefaultLocale("en_IN");
        pipelineConfig.setChannelsEnabled(List.of("SMS", "EMAIL"));

        DispatchPipelineService service = new DispatchPipelineService(new EnvelopeValidator(), denying,
                novuClient, dispatchLogRepository, pipelineConfig, mock(MdmsServiceClient.class));

        Contact contact = Contact.builder()
                .userId("uuid-123").type("CITIZEN").name("Jane Doe")
                .phone("+254712345678").email("jane@example.com").locale("en_IN").build();
        ComplaintsDomainEvent event = ComplaintsDomainEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel("SMS").subscriberId("ke.bomet:uuid-123").contact(contact)
                .renderedBody("Dear Jane, your complaint PGR-001 is assigned.")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS")
                .build();

        service.process(event, true, null);

        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(captor.capture());
        assertEquals("SKIPPED", captor.getValue().getStatus());
        assertEquals("NB_PREFERENCE_DENIED", captor.getValue().getLastErrorCode());
    }
}
