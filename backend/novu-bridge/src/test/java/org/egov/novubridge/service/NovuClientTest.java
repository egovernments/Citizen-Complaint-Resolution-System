package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Coverage of the two new {@link NovuClient} methods used by provider management:
 * {@code createIntegration} (bootstrap-shaped {@code POST /v1/integrations} payload,
 * ApiKey applied server-side) and {@code listWorkflows} ({@code GET /v2/workflows}).
 */
class NovuClientTest {

    private RestTemplate restTemplate;
    private NovuBridgeConfiguration config;
    private NovuClient novuClient;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setNovuBaseUrl("http://novu:3000");
        config.setNovuApiKey("secret-key");
        novuClient = new NovuClient(restTemplate, config);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test
    void createIntegration_postsBootstrapShapedPayload_withApiKeyHeader() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("data", Map.of("_id", "i1"))));

        Map<String, Object> creds = new LinkedHashMap<>();
        creds.put("accountSid", "AC123");
        creds.put("token", "tok");
        creds.put("from", "+15550100");

        NovuClient.NovuResponse res =
                novuClient.createIntegration("Twilio SMS", "twilio-sms", "twilio", "sms", creds);

        assertEquals(200, res.getStatusCode());

        ArgumentCaptor<String> url = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<HttpEntity> ent = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(url.capture(), eq(HttpMethod.POST), ent.capture(), eq(Map.class));

        assertEquals("http://novu:3000/v1/integrations", url.getValue());
        Map<String, Object> body = (Map<String, Object>) ent.getValue().getBody();
        assertEquals("Twilio SMS", body.get("name"));
        assertEquals("twilio-sms", body.get("identifier"));
        assertEquals("twilio", body.get("providerId"));
        assertEquals("sms", body.get("channel"));
        assertEquals(true, body.get("active"));
        assertEquals(false, body.get("check"));
        assertEquals(creds, body.get("credentials"));
        // ApiKey held server-side; never surfaced to the SPA.
        assertEquals("ApiKey secret-key", ent.getValue().getHeaders().getFirst("Authorization"));
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test
    void createIntegration_omitsIdentifierWhenBlank() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("data", Map.of("_id", "i1"))));

        novuClient.createIntegration("SMTP", null, "nodemailer", "email", Map.of("host", "smtp"));

        ArgumentCaptor<HttpEntity> ent = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(anyString(), eq(HttpMethod.POST), ent.capture(), eq(Map.class));
        Map<String, Object> body = (Map<String, Object>) ent.getValue().getBody();
        assertEquals(false, body.containsKey("identifier"));
        assertEquals("email", body.get("channel"));
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test
    void listWorkflows_getsV2WorkflowsUrl() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(
                        Map.of("data", List.of(Map.of("workflowId", "complaints-sms")))));

        NovuClient.NovuResponse res = novuClient.listWorkflows();
        assertEquals(200, res.getStatusCode());

        ArgumentCaptor<String> url = ArgumentCaptor.forClass(String.class);
        verify(restTemplate).exchange(url.capture(), eq(HttpMethod.GET), any(), eq(Map.class));
        assertEquals("http://novu:3000/v2/workflows?limit=100&page=0", url.getValue());
    }
}
