package org.egov.novubridge.web.controllers;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.web.models.IntegrationListResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * NB-5: the read-only {@code /novu-adapter/v1/integrations} proxy. W3 replaced the
 * old denylist "mask known credential locations" scheme with an ALLOWLIST
 * projection — the response is rebuilt from a fixed set of non-secret fields
 * ({@code _id}, {@code providerId}, {@code channel}, {@code name}, {@code identifier},
 * {@code active}, {@code primary}, {@code environmentId}). Anything else, including a
 * {@code credentials} key in ANY shape (map, nested map, list) and at ANY location,
 * is simply never copied — so no secret can leak even if Novu stores it outside a
 * {@code credentials} object.
 *
 * <p>These assertions target the allowlist behavior that actually exists now, not
 * the plan's original denylist "values masked to ***" wording.
 */
class IntegrationControllerTest {

    private NovuClient novuClient;
    private IntegrationController controller;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        controller = new IntegrationController(novuClient);
    }

    private void stubNovuBody(Map<String, Object> body) {
        when(novuClient.listIntegrations())
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(200).response(body).build());
    }

    private Map<String, Object> body(List<Map<String, Object>> integrations) {
        Map<String, Object> b = new HashMap<>();
        b.put("data", integrations);
        return b;
    }

    @Test
    void onlyAllowlistedFieldsProjected_credentialsDropped() {
        Map<String, Object> integ = new LinkedHashMap<>();
        integ.put("_id", "i1");
        integ.put("providerId", "twilio");
        integ.put("channel", "sms");
        integ.put("name", "Twilio SMS");
        integ.put("active", true);
        integ.put("credentials", Map.of("apiKey", "SECRET", "from", "+15550100"));
        integ.put("conditions", List.of("x"));
        integ.put("deleted", false);
        stubNovuBody(body(List.of(integ)));

        Map<String, Object> projected = controller.integrations().getBody().getData().get(0);

        assertEquals("i1", projected.get("_id"));
        assertEquals("twilio", projected.get("providerId"));
        assertEquals("sms", projected.get("channel"));
        assertEquals("Twilio SMS", projected.get("name"));
        assertEquals(true, projected.get("active"));
        // Non-allowlisted keys are dropped wholesale.
        assertFalse(projected.containsKey("credentials"), "credentials must never be projected");
        assertFalse(projected.containsKey("conditions"));
        assertFalse(projected.containsKey("deleted"));
    }

    @Test
    void nestedAndListCredentials_areNeverProjected() {
        Map<String, Object> integ = new HashMap<>();
        integ.put("providerId", "twilio");
        integ.put("meta", Map.of("inner", Map.of("credentials", Map.of("token", "SECRET"))));
        integ.put("steps", List.of(Map.of("credentials", Map.of("password", "SECRET"))));
        stubNovuBody(body(List.of(integ)));

        Map<String, Object> projected = controller.integrations().getBody().getData().get(0);

        assertEquals(1, projected.size(), "only providerId is on the allowlist");
        assertEquals("twilio", projected.get("providerId"));
        assertFalse(projected.containsKey("meta"));
        assertFalse(projected.containsKey("steps"));
    }

    @Test
    void credentialsAsList_isDroppedByAllowlist_noLeak() {
        // Pre-W3 the denylist only masked credentials-when-Map; a credentials LIST leaked.
        // The allowlist projection closes that gap: credentials in any shape is never copied.
        Map<String, Object> integ = new HashMap<>();
        integ.put("providerId", "twilio");
        integ.put("credentials", List.of(Map.of("apiKey", "SECRET")));
        stubNovuBody(body(List.of(integ)));

        Map<String, Object> projected = controller.integrations().getBody().getData().get(0);
        assertFalse(projected.containsKey("credentials"));
        assertEquals("twilio", projected.get("providerId"));
    }

    @Test
    void allowlistedFieldPresentWithNull_isCopied_absentFieldNotInvented() {
        Map<String, Object> integ = new HashMap<>();
        integ.put("providerId", "twilio");
        integ.put("active", null);   // present but null → copied as null
        stubNovuBody(body(List.of(integ)));

        Map<String, Object> projected = controller.integrations().getBody().getData().get(0);
        assertTrue(projected.containsKey("active"));
        assertEquals(null, projected.get("active"));
        // identifier was absent on the source → must not be invented.
        assertFalse(projected.containsKey("identifier"));
    }

    @Test
    void responseNeverContainsKnownSecretMarker() throws Exception {
        Map<String, Object> integ = new HashMap<>();
        integ.put("providerId", "twilio");
        integ.put("channel", "sms");
        integ.put("credentials", Map.of("apiKey", "SECRET", "authToken", "SECRET"));
        integ.put("meta", Map.of("nested", Map.of("credentials", Map.of("token", "SECRET"))));
        integ.put("weirdList", List.of(Map.of("credentials", List.of(Map.of("k", "SECRET")))));
        stubNovuBody(body(List.of(integ)));

        String json = mapper.writeValueAsString(controller.integrations().getBody());
        assertFalse(json.contains("SECRET"), "no secret marker may appear anywhere in the serialized response: " + json);
    }

    @Test
    void totalEqualsProjectedCount() {
        List<Map<String, Object>> integrations = new ArrayList<>();
        integrations.add(Map.of("providerId", "twilio"));
        integrations.add(Map.of("providerId", "sendgrid"));
        stubNovuBody(body(integrations));

        IntegrationListResponse response = controller.integrations().getBody();
        assertEquals(2L, response.getTotal());
        assertEquals(2, response.getData().size());
    }

    @Test
    void nullBody_yieldsEmptyList() {
        stubNovuBody(null);
        ResponseEntity<IntegrationListResponse> response = controller.integrations();
        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().getData().isEmpty());
        assertEquals(0L, response.getBody().getTotal());
    }

    @Test
    void malformedDataNotAList_yieldsEmptyList() {
        Map<String, Object> b = new HashMap<>();
        b.put("data", "not-a-list");
        stubNovuBody(b);

        IntegrationListResponse response = controller.integrations().getBody();
        assertTrue(response.getData().isEmpty());
        assertEquals(0L, response.getTotal());
    }
}
