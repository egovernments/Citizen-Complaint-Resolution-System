package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.web.models.IntegrationListResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only proxy exposing the configured Novu provider integrations to the
 * configurator's Notification Providers screen. Sits alongside
 * {@code DispatchController} under the same {@code /novu-adapter/v1} namespace.
 *
 * <p><b>Secrets stay server-side.</b> Novu is called here with the ApiKey held
 * by {@link NovuClient} (the keyless configurator SPA never sees that key). Rather
 * than denylisting known secret locations, the response is built by an ALLOWLIST
 * projection: for each integration only a fixed set of non-secret fields
 * ({@code _id}, {@code providerId}, {@code channel}, {@code name},
 * {@code identifier}, {@code active}, {@code primary}, {@code environmentId}) is
 * copied out. Nothing else — in particular no {@code credentials} key, masked or
 * otherwise — ever leaves this service, so a secret stored outside a
 * {@code credentials} object cannot leak. There is deliberately NO endpoint that
 * returns the raw Novu key or any provider secret.
 *
 * <p><b>Observability boundary:</b> this lists the Novu-side provider configuration
 * only. All delivery now goes through Novu; channels with no active Novu integration are gated
 * off via novu.bridge.channels.enabled and show up in the dispatch log as SKIPPED.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
public class IntegrationController {

    // Only these non-secret fields are copied into the response. Everything else
    // (credentials, conditions, deleted flags, timestamps, ...) is dropped.
    private static final List<String> ALLOWED_FIELDS = List.of(
            "_id", "providerId", "channel", "name", "identifier",
            "active", "primary", "environmentId");

    private final NovuClient novuClient;

    public IntegrationController(NovuClient novuClient) {
        this.novuClient = novuClient;
    }

    /**
     * Return the Novu integration list as an allowlist projection (no secrets).
     *
     * @return {@code {data:[integration...], total}} — read-only, non-secret fields only.
     */
    @GetMapping("/integrations")
    public ResponseEntity<IntegrationListResponse> integrations() {
        NovuClient.NovuResponse novuResponse = novuClient.listIntegrations();
        List<Map<String, Object>> integrations = extractIntegrations(novuResponse.getResponse());
        List<Map<String, Object>> projected = new ArrayList<>(integrations.size());
        for (Map<String, Object> integration : integrations) {
            projected.add(projectAllowedFields(integration));
        }
        IntegrationListResponse response = IntegrationListResponse.builder()
                .data(projected)
                .total((long) projected.size())
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    /** Novu returns {@code {data: [...]}}; be defensive about the envelope shape. */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> extractIntegrations(Map<String, Object> body) {
        List<Map<String, Object>> result = new ArrayList<>();
        if (body == null) {
            return result;
        }
        Object data = body.get("data");
        if (data instanceof List) {
            for (Object item : (List<Object>) data) {
                if (item instanceof Map) {
                    result.add((Map<String, Object>) item);
                }
            }
        }
        return result;
    }

    /**
     * Build a fresh map containing ONLY the allowlisted, non-secret fields present
     * on the integration. Any field not on the allowlist (including {@code
     * credentials} at any location, in any shape) is simply never copied — so no
     * secret can leak, whether or not Novu nests it under a {@code credentials}
     * key. Fields absent on a given integration are dropped rather than invented.
     */
    private Map<String, Object> projectAllowedFields(Map<String, Object> integration) {
        Map<String, Object> projected = new LinkedHashMap<>();
        for (String field : ALLOWED_FIELDS) {
            if (integration.containsKey(field)) {
                projected.put(field, integration.get(field));
            }
        }
        return projected;
    }
}
