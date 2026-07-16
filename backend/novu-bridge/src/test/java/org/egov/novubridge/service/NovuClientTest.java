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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Coverage of the two new {@link NovuClient} methods used by provider management:
 * {@code createIntegration} (bootstrap-shaped {@code POST /v1/integrations} payload,
 * ApiKey applied server-side) and {@code listWorkflows} ({@code GET /v2/workflows}).
 *
 * <p>Also covers the WHATSAPP branch of {@code identifyThenTrigger}: this is where the
 * per-tenant Twilio "from" sender override (resolved from MDMS ProviderDetail) and the
 * "whatsapp:" recipient-phone prefixing now live, moved out of DispatchPipelineService.
 */
class NovuClientTest {

    private RestTemplate restTemplate;
    private NovuBridgeConfiguration config;
    private MdmsServiceClient mdmsServiceClient;
    private NovuClient novuClient;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setNovuBaseUrl("http://novu:3000");
        config.setNovuApiKey("secret-key");
        config.setNovuWorkflowWhatsapp("complaints-whatsapp");
        mdmsServiceClient = mock(MdmsServiceClient.class);
        novuClient = new NovuClient(restTemplate, config, mdmsServiceClient);
    }

    private Contact whatsappContact() {
        return Contact.builder()
                .userId("uuid-123").type("CITIZEN").name("Jane Doe")
                .phone("+254712345678").email("jane@example.com").locale("en_IN")
                .build();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test
    void identifyThenTrigger_whatsapp_noSenderConfigured_triggersWithoutOverrides() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("acknowledged", true)));
        // No ProviderDetail configured for this tenant: getWhatsappSenderNumber() returns null.
        when(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet")).thenReturn(null);

        NovuClient.NovuResponse res = novuClient.identifyThenTrigger("ke.bomet:uuid-123", whatsappContact(),
                "WHATSAPP", "Dear Jane, your complaint PGR-001 is assigned.", null,
                "PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP", Map.of(), "ke.bomet");

        assertEquals(200, res.getStatusCode());

        // identify() (subscribers) then trigger() (events/trigger) — in that order.
        ArgumentCaptor<HttpEntity> entities = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate, times(2)).exchange(anyString(), eq(HttpMethod.POST), entities.capture(), eq(Map.class));
        Map<String, Object> triggerBody = (Map<String, Object>) entities.getAllValues().get(1).getBody();

        assertEquals("complaints-whatsapp", triggerBody.get("name"));
        Map<String, Object> to = (Map<String, Object>) triggerBody.get("to");
        // The recipient's "to" phone is E.164-already, so it is only prefixed with "whatsapp:".
        assertEquals("whatsapp:+254712345678", to.get("phone"));
        assertFalse(triggerBody.containsKey("overrides"));
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test
    void identifyThenTrigger_whatsapp_senderConfigured_triggersWithFromOverride() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("acknowledged", true)));
        // ProviderDetail in MDMS carries a raw (unprefixed) Twilio WhatsApp sender number.
        when(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet")).thenReturn("+14155550123");

        NovuClient.NovuResponse res = novuClient.identifyThenTrigger("ke.bomet:uuid-123", whatsappContact(),
                "WHATSAPP", "Dear Jane, your complaint PGR-001 is assigned.", null,
                "PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP", Map.of(), "ke.bomet");

        assertEquals(200, res.getStatusCode());

        ArgumentCaptor<HttpEntity> entities = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate, times(2)).exchange(anyString(), eq(HttpMethod.POST), entities.capture(), eq(Map.class));
        Map<String, Object> triggerBody = (Map<String, Object>) entities.getAllValues().get(1).getBody();

        Map<String, Object> overrides = (Map<String, Object>) triggerBody.get("overrides");
        Map<String, Object> providers = (Map<String, Object>) overrides.get("providers");
        Map<String, Object> twilio = (Map<String, Object>) providers.get("twilio");
        // The bare MDMS number is prefixed with "whatsapp:" before being sent as the override.
        assertEquals("whatsapp:+14155550123", twilio.get("from"));
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test
    void identifyThenTrigger_whatsapp_senderAlreadyPrefixed_isNotDoublePrefixed() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("acknowledged", true)));
        when(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet")).thenReturn("whatsapp:+14155550123");

        novuClient.identifyThenTrigger("ke.bomet:uuid-123", whatsappContact(), "WHATSAPP",
                "Dear Jane, your complaint PGR-001 is assigned.", null,
                "PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP", Map.of(), "ke.bomet");

        ArgumentCaptor<HttpEntity> entities = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate, times(2)).exchange(anyString(), eq(HttpMethod.POST), entities.capture(), eq(Map.class));
        Map<String, Object> triggerBody = (Map<String, Object>) entities.getAllValues().get(1).getBody();

        Map<String, Object> overrides = (Map<String, Object>) triggerBody.get("overrides");
        Map<String, Object> providers = (Map<String, Object>) overrides.get("providers");
        Map<String, Object> twilio = (Map<String, Object>) providers.get("twilio");
        assertEquals("whatsapp:+14155550123", twilio.get("from"));
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Test
    void identifyThenTrigger_whatsapp_blankTenantId_skipsMdmsLookup_triggersWithoutOverrides() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("acknowledged", true)));

        novuClient.identifyThenTrigger("ke.bomet:uuid-123", whatsappContact(), "WHATSAPP",
                "Dear Jane, your complaint PGR-001 is assigned.", null,
                "PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP", Map.of(), null);

        verify(mdmsServiceClient, times(0)).getWhatsappSenderNumber(any());
        ArgumentCaptor<HttpEntity> entities = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate, times(2)).exchange(anyString(), eq(HttpMethod.POST), entities.capture(), eq(Map.class));
        Map<String, Object> triggerBody = (Map<String, Object>) entities.getAllValues().get(1).getBody();
        assertFalse(triggerBody.containsKey("overrides"));
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
