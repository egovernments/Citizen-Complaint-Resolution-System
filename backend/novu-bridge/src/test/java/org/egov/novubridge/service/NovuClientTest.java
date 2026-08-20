package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.Contact;
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
import static org.junit.jupiter.api.Assertions.assertFalse;
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

    private Contact whatsappContact() {
        return Contact.builder().userId("uuid-1").type("CITIZEN").name("Jane Doe")
                .phone("whatsapp:+254712345678").locale("en_IN").build();
    }

    /**
     * Novu resolves the PRIMARY integration for a channel unless the trigger names an
     * explicit overrides.<channel>.integrationIdentifier. WhatsApp-via-Twilio is an
     * "sms"-channel step in Novu, so a dedicated WhatsApp integration living alongside
     * the primary (plain SMS) one would otherwise never be picked. When
     * novu.bridge.integration.id.whatsapp is configured, a WHATSAPP dispatch (always
     * carries a Twilio Content SID templateId — see DispatchPipelineService's template
     * gate) must ask for that integration explicitly.
     */
    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test
    void identifyThenTrigger_whatsappWithConfiguredIntegration_overridesSmsIntegrationIdentifier() {
        config.setWhatsappIntegrationId("twilio-whatsapp");
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("acknowledged", true)));

        novuClient.identifyThenTrigger("ke.bomet:uuid-1", whatsappContact(), "WHATSAPP",
                "Dear Jane, your complaint is assigned.", null, "txn-1", Map.of(),
                "HX00000000000000000000000000000000", null);

        ArgumentCaptor<HttpEntity> ent = ArgumentCaptor.forClass(HttpEntity.class);
        // Two POSTs: /v1/subscribers (identify) then /v1/events/trigger — the trigger is the last one.
        verify(restTemplate, org.mockito.Mockito.times(2))
                .exchange(anyString(), eq(HttpMethod.POST), ent.capture(), eq(Map.class));
        Map<String, Object> triggerBody = (Map<String, Object>) ent.getAllValues().get(1).getBody();

        Map<String, Object> overrides = (Map<String, Object>) triggerBody.get("overrides");
        Map<String, Object> smsOverride = (Map<String, Object>) overrides.get("sms");
        assertEquals("twilio-whatsapp", smsOverride.get("integrationIdentifier"));
        // The Twilio Content SID override must still be present alongside it.
        Map<String, Object> providers = (Map<String, Object>) overrides.get("providers");
        Map<String, Object> twilio = (Map<String, Object>) providers.get("twilio");
        Map<String, Object> passthroughBody = (Map<String, Object>) ((Map<String, Object>) twilio.get("_passthrough")).get("body");
        assertEquals("HX00000000000000000000000000000000", passthroughBody.get("contentSid"));
    }

    /** Unconfigured (default, blank) whatsappIntegrationId: no override — existing deployments unaffected. */
    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test
    void identifyThenTrigger_whatsappWithoutConfiguredIntegration_sendsNoIntegrationOverride() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("acknowledged", true)));

        novuClient.identifyThenTrigger("ke.bomet:uuid-1", whatsappContact(), "WHATSAPP",
                "Dear Jane, your complaint is assigned.", null, "txn-1", Map.of(),
                "HX00000000000000000000000000000000", null);

        ArgumentCaptor<HttpEntity> ent = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate, org.mockito.Mockito.times(2))
                .exchange(anyString(), eq(HttpMethod.POST), ent.capture(), eq(Map.class));
        Map<String, Object> triggerBody = (Map<String, Object>) ent.getAllValues().get(1).getBody();
        Map<String, Object> overrides = (Map<String, Object>) triggerBody.get("overrides");
        assertFalse(overrides.containsKey("sms"));
    }
}
