package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * getWhatsappSenderNumber() reads the per-tenant Twilio WhatsApp sender number
 * from the {@code ProviderDetail} MDMS schema, used by DispatchPipelineService
 * to build the Novu {@code overrides.providers.twilio.from} override.
 */
class MdmsServiceClientWhatsappSenderTest {

    private RestTemplate restTemplate;
    private NovuBridgeConfiguration config;
    private MdmsServiceClient mdmsServiceClient;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setMdmsHost("http://localhost:8082");
        config.setMdmsSearchPath("/egov-mdms-service/v2/_search");
        mdmsServiceClient = new MdmsServiceClient(restTemplate, config);
    }

    @SuppressWarnings("unchecked")
    private void stubMdmsResponse(List<Map<String, Object>> mdmsRecords) {
        Map<String, Object> body = new HashMap<>();
        body.put("mdms", mdmsRecords);
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity<>(body, HttpStatus.OK));
    }

    private Map<String, Object> providerRecord(String channel, boolean isActive, String senderNumber) {
        Map<String, Object> data = new HashMap<>();
        data.put("tenantId", "ke.bomet");
        data.put("providerName", "twilio");
        data.put("channel", channel);
        data.put("isActive", isActive);
        data.put("senderNumber", senderNumber);
        Map<String, Object> record = new HashMap<>();
        record.put("data", data);
        return record;
    }

    @Test
    void activeWhatsappRecord_returnsSenderNumber() {
        stubMdmsResponse(List.of(providerRecord("whatsapp", true, "+14155550123")));

        String senderNumber = mdmsServiceClient.getWhatsappSenderNumber("ke.bomet");

        assertEquals("+14155550123", senderNumber);
    }

    @Test
    void inactiveWhatsappRecord_isIgnored_returnsNull() {
        stubMdmsResponse(List.of(providerRecord("whatsapp", false, "+14155550123")));

        assertNull(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet"));
    }

    @Test
    void nonWhatsappChannelRecord_isIgnored_returnsNull() {
        stubMdmsResponse(List.of(providerRecord("sms", true, "+14155550999")));

        assertNull(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet"));
    }

    @Test
    void mixedRecords_picksTheActiveWhatsappOne() {
        stubMdmsResponse(List.of(
                providerRecord("sms", true, "+14155550999"),
                providerRecord("whatsapp", false, "+14155550001"),
                providerRecord("whatsapp", true, "+14155550123")));

        assertEquals("+14155550123", mdmsServiceClient.getWhatsappSenderNumber("ke.bomet"));
    }

    @Test
    void noRecords_returnsNull() {
        stubMdmsResponse(List.of());

        assertNull(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet"));
    }

    @Test
    void non2xxResponse_returnsNull_doesNotThrow() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity<>(HttpStatus.INTERNAL_SERVER_ERROR));

        assertNull(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet"));
    }

    @Test
    void restTemplateThrows_returnsNull_doesNotThrow() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new RuntimeException("MDMS unreachable"));

        assertNull(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet"));
    }

    @Test
    void secondLookupForSameTenant_isServedFromCache_doesNotCallMdmsAgain() {
        stubMdmsResponse(List.of(providerRecord("whatsapp", true, "+14155550123")));

        assertEquals("+14155550123", mdmsServiceClient.getWhatsappSenderNumber("ke.bomet"));
        assertEquals("+14155550123", mdmsServiceClient.getWhatsappSenderNumber("ke.bomet"));

        verify(restTemplate, times(1)).exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class));
    }
}
