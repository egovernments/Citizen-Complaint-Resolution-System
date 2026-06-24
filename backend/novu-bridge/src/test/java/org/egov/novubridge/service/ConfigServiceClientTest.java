package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.tracer.model.CustomException;
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

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Unit tests for the tenant channel config lookup ({@link ConfigServiceClient#getEnabledChannels}).
 * Verifies the legacy-fallback contract: null = unconfigured (caller falls back to the allow-list),
 * list = the enabled codes (empty when everything is explicitly disabled).
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

    private void stubSearch(ResponseEntity<Map> response) {
        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(response);
    }

    @Test
    void getEnabledChannels_returnsEnabledCodesLowercased() {
        Map<String, Object> body = Map.of("configData", List.of(
                Map.of("data", Map.of("code", "WHATSAPP", "enabled", true)),
                Map.of("data", Map.of("code", "SMS", "enabled", false)),     // filtered out
                Map.of("data", Map.of("code", "EMAIL", "enabled", true))));
        stubSearch(new ResponseEntity<>(body, HttpStatus.OK));

        assertEquals(List.of("whatsapp", "email"), client.getEnabledChannels("pb.amritsar"));
    }

    @Test
    void getEnabledChannels_configuredButAllDisabled_returnsEmptyList() {
        Map<String, Object> body = Map.of("configData", List.of(
                Map.of("data", Map.of("code", "WHATSAPP", "enabled", false))));
        stubSearch(new ResponseEntity<>(body, HttpStatus.OK));

        // Configured (records exist) but nothing enabled -> empty list, NOT null (no legacy fallback).
        assertTrue(client.getEnabledChannels("pb.amritsar").isEmpty());
    }

    @Test
    void getEnabledChannels_noRecords_returnsNullForLegacyFallback() {
        stubSearch(new ResponseEntity<>(Map.of(), HttpStatus.OK));         // no configData
        assertNull(client.getEnabledChannels("pb.amritsar"));

        stubSearch(new ResponseEntity<>(Map.of("configData", List.of()), HttpStatus.OK)); // empty list
        assertNull(client.getEnabledChannels("pb.amritsar"));
    }

    @Test
    void getEnabledChannels_lookupThrows_propagatesForRetry() {
        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new RuntimeException("config-service unreachable"));

        // A hard error must NOT be confused with "unconfigured": throw so the event is retried/DLQ'd
        // rather than silently falling back (which would ignore an explicit disable) or dropping.
        assertThrows(CustomException.class, () -> client.getEnabledChannels("pb.amritsar"));
    }

    @Test
    void getEnabledChannels_nonSuccessResponse_throws() {
        stubSearch(new ResponseEntity<>(Map.of(), HttpStatus.INTERNAL_SERVER_ERROR));
        assertThrows(CustomException.class, () -> client.getEnabledChannels("pb.amritsar"));
    }

    @Test
    void getEnabledChannels_searchRequestHasNoEnabledFilter() {
        Map<String, Object> body = Map.of("configData", List.of(
                Map.of("data", Map.of("code", "WHATSAPP", "enabled", true))));
        ArgumentCaptor<HttpEntity> captor = ArgumentCaptor.forClass(HttpEntity.class);
        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), captor.capture(), eq(Map.class)))
                .thenReturn(new ResponseEntity<>(body, HttpStatus.OK));

        client.getEnabledChannels("pb.amritsar");

        Map<String, Object> sent = (Map<String, Object>) captor.getValue().getBody();
        Map<String, Object> criteria = (Map<String, Object>) sent.get("criteria");
        assertEquals("NotificationChannel", criteria.get("schemaCode"));
        assertEquals("pb.amritsar", criteria.get("tenantId"));
        // We fetch ALL records (to detect "unconfigured"), so no enabled filter is sent.
        assertFalse(criteria.containsKey("criteria"));
    }
}
