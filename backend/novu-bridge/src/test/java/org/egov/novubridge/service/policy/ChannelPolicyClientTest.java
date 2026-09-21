package org.egov.novubridge.service.policy;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ChannelPolicyClientTest {

    private RestTemplate restTemplate;
    private NovuBridgeConfiguration config;
    private ChannelPolicyClient client;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setChannelPolicyEnabled(true);
        config.setChannelPolicySchema("RAINMAKER-PGR.NotificationChannel");
        config.setChannelPolicyCacheTtlMs(60_000L);
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        config.setChannelsEnabled(List.of("EMAIL"));      // env fallback: only EMAIL
        config.setSmsProvider("");
        config.setSmsSenderId("ENVSID");
        client = new ChannelPolicyClient(restTemplate, config);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void stubRows(Map<String, Object>... rows) {
        Map<String, Object> body = Map.of("mdms", List.of(rows));
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(body, HttpStatus.OK));
    }

    private static Map<String, Object> row(String code, boolean enabled, String gateway, String senderId) {
        return row(code, enabled, gateway, senderId, null);
    }

    private static Map<String, Object> row(String code, boolean enabled, String gateway, String senderId,
                                           String provider) {
        Map<String, Object> data = new java.util.HashMap<>();
        data.put("code", code); data.put("enabled", enabled); data.put("active", true);
        if (gateway != null) data.put("gateway", gateway);
        if (senderId != null) data.put("senderId", senderId);
        if (provider != null) data.put("provider", provider);
        return Map.of("uniqueIdentifier", code, "isActive", true, "data", data);
    }

    @Test
    void mdmsRowsDecideEnablement_perTenant_atTheStateRoot() {
        stubRows(row("WHATSAPP", true, "novu", null), row("SMS", false, "smscountry", "KE-GOV"));
        assertTrue(client.isEnabled("ke.bomet", "WHATSAPP"), "WHATSAPP on via MDMS even though env says EMAIL only");
        assertFalse(client.isEnabled("ke.bomet", "SMS"));
        assertEquals("smscountry", client.gateway("ke.bomet", "SMS"));
        assertEquals("KE-GOV", client.senderId("ke.bomet", "SMS"));
        assertEquals("novu", client.gateway("ke.bomet", "WHATSAPP"));
        // Absent row for a channel the tenant HAS policy for → not enabled (no env leakage).
        assertFalse(client.isEnabled("ke.bomet", "EMAIL"));
    }

    @Test
    void noRowsForTenant_fallsBackToEnv() {
        stubRows();
        assertTrue(client.isEnabled("mz", "EMAIL"));
        assertFalse(client.isEnabled("mz", "SMS"));
        assertEquals("novu", client.gateway("mz", "SMS"));
        assertEquals("ENVSID", client.senderId("mz", "SMS"));
    }

    @Test
    void policyDisabled_orNoRestTemplate_isEnvOnly() {
        config.setChannelPolicyEnabled(false);
        assertTrue(client.isEnabled("ke", "EMAIL"));
        verifyNoInteractions(restTemplate);
        ChannelPolicyClient noRest = new ChannelPolicyClient(null, config);
        config.setChannelPolicyEnabled(true);
        assertTrue(noRest.isEnabled("ke", "EMAIL"));
    }

    @Test
    void secondLookupWithinTtl_isServedFromCache() {
        stubRows(row("SMS", true, null, null));
        client.isEnabled("ke.bomet", "SMS");
        client.isEnabled("ke.nairobi", "SMS");   // same state root
        verify(restTemplate, times(1)).exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void mdmsOutage_servesStaleRows_orEnvWhenNothingCached() {
        stubRows(row("SMS", true, null, null));
        assertTrue(client.isEnabled("ke", "SMS"));
        config.setChannelPolicyCacheTtlMs(0L);   // force refetch
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new ResourceAccessException("down"));
        assertTrue(client.isEnabled("ke", "SMS"), "stale rows beat dropping notifications");
        assertTrue(client.isEnabled("mz", "EMAIL"), "never-fetched tenant uses env during the outage");
    }

    // ---- provider: the ONE integration active for a channel ---------------

    @Test
    void providerIsReadFromTheRow_andTrimmed() {
        stubRows(row("SMS", true, null, null, "  smscountry-abcdef01  "),
                row("EMAIL", true, null, null, "smtp-deadbeef"));
        assertEquals("smscountry-abcdef01", client.provider("ke.bomet", "SMS"));
        assertEquals("smtp-deadbeef", client.provider("ke.bomet", "EMAIL"));
    }

    @Test
    void aRowWithoutAProviderYieldsNull_soTheGatewayAndEnvFallbacksStillDecide() {
        // Deployed tenants (bomet) have no `provider` field at all; they must keep the
        // gateway-based routing they run today.
        stubRows(row("SMS", true, "smscountry", "KE-GOV"));
        assertNull(client.provider("ke.bomet", "SMS"));
        assertEquals("smscountry", client.gateway("ke.bomet", "SMS"));
        assertNull(client.provider("ke.bomet", "WHATSAPP"), "a channel with no row has no provider");
    }

    @Test
    void noRowsAtAll_meansNoProvider_neverAnEnvDerivedOne() {
        stubRows();
        assertNull(client.provider("mz", "SMS"));
    }

    @Test
    void blankProviderIsTreatedAsUnset() {
        stubRows(row("SMS", true, null, null, "   "));
        assertNull(client.provider("ke", "SMS"));
    }

    @Test
    void providerInUseIsDetectedAcrossEveryChannelOfTheTenant() {
        stubRows(row("SMS", true, null, null, "smscountry-abcdef01"),
                row("EMAIL", true, null, null, "smtp-deadbeef"));
        assertTrue(client.isProviderInUse("ke.bomet", "smscountry-abcdef01"));
        assertTrue(client.isProviderInUse("ke.bomet", "smtp-deadbeef"));
        assertFalse(client.isProviderInUse("ke.bomet", "ozeki-nobody-uses-this"));
        assertFalse(client.isProviderInUse("ke.bomet", null));
    }

    @Test
    void inUseWithoutATenantScansTheTenantsAlreadySeen() {
        stubRows(row("SMS", true, null, null, "ozeki-0011aabb"));
        assertFalse(client.isProviderInUse(null, "ozeki-0011aabb"), "nothing cached yet, so nothing to find");
        client.provider("ke.bomet", "SMS");   // warm the cache as a live dispatch would
        assertTrue(client.isProviderInUse(null, "ozeki-0011aabb"));
    }

    @Test
    void stateTenantIsTheFirstSegment() {
        assertEquals("ke", ChannelPolicyClient.stateTenant("ke.bomet"));
        assertEquals("ke", ChannelPolicyClient.stateTenant("ke"));
        assertNull(ChannelPolicyClient.stateTenant(null));
    }
}
