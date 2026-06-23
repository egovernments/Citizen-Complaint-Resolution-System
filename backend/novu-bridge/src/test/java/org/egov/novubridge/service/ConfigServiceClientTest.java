package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Unit tests for the tenant-level channel toggle ({@link ConfigServiceClient#isChannelEnabled}).
 * Verifies the default-OFF / fail-closed contract that gates dispatch.
 */
public class ConfigServiceClientTest {

    @Mock
    private RestTemplate restTemplate;

    private NovuBridgeConfiguration config;
    private ConfigServiceClient client;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        config = new NovuBridgeConfiguration();
        config.setConfigHost("http://config-service");
        config.setConfigResolvePath("/config-service/config/v1/_resolve");
        config.setConfigSearchPath("/config-service/config/v1/_search");
        client = new ConfigServiceClient(restTemplate, config);
    }

    private void stubResolve(ResponseEntity<Map> response) {
        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(response);
    }

    @Test
    void enabledRecord_returnsTrue() {
        Map<String, Object> body = Map.of("configData", Map.of("data", Map.of("code", "WHATSAPP", "enabled", true)));
        stubResolve(new ResponseEntity<>(body, HttpStatus.OK));

        assertTrue(client.isChannelEnabled("pb.amritsar", "whatsapp"));
    }

    @Test
    void disabledRecord_returnsFalse() {
        Map<String, Object> body = Map.of("configData", Map.of("data", Map.of("code", "WHATSAPP", "enabled", false)));
        stubResolve(new ResponseEntity<>(body, HttpStatus.OK));

        assertFalse(client.isChannelEnabled("pb.amritsar", "whatsapp"));
    }

    @Test
    void noRecord_defaultsOff() {
        // config-service returns 200 with no configData -> tenant never opted in
        stubResolve(new ResponseEntity<>(Map.of(), HttpStatus.OK));

        assertFalse(client.isChannelEnabled("pb.amritsar", "whatsapp"));
    }

    @Test
    void lookupThrows_failsClosed() {
        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new RuntimeException("config-service unreachable"));

        assertFalse(client.isChannelEnabled("pb.amritsar", "whatsapp"));
    }

    @Test
    void normalisesLowercaseChannelToUppercaseCode() {
        Map<String, Object> body = Map.of("configData", Map.of("data", Map.of("code", "WHATSAPP", "enabled", true)));
        ArgumentCaptor<HttpEntity> captor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), captor.capture(), eq(Map.class)))
                .thenReturn(new ResponseEntity<>(body, HttpStatus.OK));

        client.isChannelEnabled("pb.amritsar", "whatsapp");

        Map<String, Object> sent = (Map<String, Object>) captor.getValue().getBody();
        Map<String, Object> resolveRequest = (Map<String, Object>) sent.get("resolveRequest");
        Map<String, Object> criteria = (Map<String, Object>) resolveRequest.get("criteria");
        assertTrue("WHATSAPP".equals(criteria.get("code")));
    }

    @Test
    void getEnabledChannels_returnsEnabledCodesLowercased() {
        Map<String, Object> body = Map.of("configData", java.util.List.of(
                Map.of("data", Map.of("code", "WHATSAPP", "enabled", true)),
                Map.of("data", Map.of("code", "SMS", "enabled", false)),   // filtered out
                Map.of("data", Map.of("code", "EMAIL", "enabled", true))));
        stubResolve(new ResponseEntity<>(body, HttpStatus.OK));

        java.util.List<String> channels = client.getEnabledChannels("pb.amritsar");

        assertEquals(java.util.List.of("whatsapp", "email"), channels);
    }

    @Test
    void getEnabledChannels_noRecords_returnsEmpty() {
        stubResolve(new ResponseEntity<>(Map.of(), HttpStatus.OK));

        assertTrue(client.getEnabledChannels("pb.amritsar").isEmpty());
    }

    @Test
    void getEnabledChannels_lookupThrows_failsClosed() {
        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new RuntimeException("config-service unreachable"));

        assertTrue(client.getEnabledChannels("pb.amritsar").isEmpty());
    }
}
