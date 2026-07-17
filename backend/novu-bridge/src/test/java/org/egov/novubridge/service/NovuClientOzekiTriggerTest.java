package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.provider.OzekiOverridesBuilder;
import org.egov.novubridge.web.models.Contact;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Coverage of the Ozeki gate in {@link NovuClient#identifyThenTrigger}: the
 * generic-sms overrides envelope must be attached to the trigger request only
 * when {@code novu.bridge.sms.provider=ozeki} AND the channel is SMS — never
 * for other channels, never with the default (empty) provider.
 */
class NovuClientOzekiTriggerTest {

    private static final String TXN = "txn-42";
    private static final String PHONE = "+254712345678";
    private static final String BODY = "Your complaint PGR-1 was resolved";

    private RestTemplate restTemplate;
    private NovuBridgeConfiguration config;
    private NovuClient novuClient;

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setNovuBaseUrl("http://novu:3000");
        config.setNovuApiKey("secret-key");
        config.setNovuWorkflowSms("complaints-sms");
        config.setNovuWorkflowEmail("complaints-email");
        config.setIdentifyCacheTtlMs(0L);
        config.setOzekiIntegrationIdentifier("ozeki-sms");
        novuClient = new NovuClient(restTemplate, config);

        // identifyThenTrigger POSTs /v1/subscribers (identify) then /v1/events/trigger.
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("data", Map.of("acknowledged", true))));
    }

    /** Captures every POST exchange and returns the body of the LAST one (the trigger). */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private Map<String, Object> lastRequestBody() {
        ArgumentCaptor<HttpEntity> ent = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate, atLeast(1))
                .exchange(anyString(), eq(HttpMethod.POST), ent.capture(), eq(Map.class));
        List<HttpEntity> all = ent.getAllValues();
        return (Map<String, Object>) all.get(all.size() - 1).getBody();
    }

    @SuppressWarnings("unchecked")
    @Test
    void smsWithOzekiProvider_attachesOverridesEnvelope() {
        config.setSmsProvider("ozeki");
        Contact contact = Contact.builder().phone(PHONE).name("Jane Doe").build();

        novuClient.identifyThenTrigger("ke.bomet:u1", contact, "SMS", BODY, null, TXN, null);

        Map<String, Object> request = lastRequestBody();
        assertEquals("complaints-sms", request.get("name"));
        assertTrue(request.containsKey("overrides"), "SMS + ozeki must attach overrides");

        Map<String, Object> overrides = (Map<String, Object>) request.get("overrides");
        Map<String, Object> sms = (Map<String, Object>) overrides.get("sms");
        assertEquals("ozeki-sms", sms.get("integrationIdentifier"));

        Map<String, Object> providers = (Map<String, Object>) overrides.get("providers");
        Map<String, Object> generic =
                (Map<String, Object>) providers.get(OzekiOverridesBuilder.NOVU_PROVIDER_ID);
        Map<String, Object> passthroughBody =
                (Map<String, Object>) ((Map<String, Object>) generic.get("_passthrough")).get("body");
        List<Map<String, Object>> messages = (List<Map<String, Object>>) passthroughBody.get("messages");
        assertEquals(1, messages.size());
        assertEquals(Map.of("message_id", TXN, "to_address", PHONE, "text", BODY), messages.get(0));
    }

    @Test
    void emailWithOzekiProvider_hasNoOverrides() {
        config.setSmsProvider("ozeki");
        Contact contact = Contact.builder().email("jane@example.org").name("Jane Doe").build();

        novuClient.identifyThenTrigger("ke.bomet:u1", contact, "EMAIL", BODY, "Subject", TXN, null);

        Map<String, Object> request = lastRequestBody();
        assertEquals("complaints-email", request.get("name"));
        assertFalse(request.containsKey("overrides"), "Ozeki envelope is SMS-only");
    }

    @Test
    void smsWithDefaultProvider_hasNoOverrides() {
        config.setSmsProvider(""); // @Value default: novu.bridge.sms.provider unset
        Contact contact = Contact.builder().phone(PHONE).build();

        novuClient.identifyThenTrigger("ke.bomet:u1", contact, "SMS", BODY, null, TXN, null);

        Map<String, Object> request = lastRequestBody();
        assertEquals("complaints-sms", request.get("name"));
        assertFalse(request.containsKey("overrides"), "default provider must not attach overrides");
    }
}
