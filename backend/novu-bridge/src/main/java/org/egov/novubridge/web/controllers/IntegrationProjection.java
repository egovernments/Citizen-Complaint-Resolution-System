package org.egov.novubridge.web.controllers;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Shared ALLOWLIST projection for Novu integration objects. Single source of
 * truth reused by {@link IntegrationController} (list view) and
 * {@link ProviderController} (create/verify) so a secret can never leak through
 * either path.
 *
 * <p>Rather than denylisting known secret locations, the response is rebuilt
 * from a fixed set of non-secret fields ({@code _id}, {@code providerId},
 * {@code channel}, {@code name}, {@code identifier}, {@code active},
 * {@code primary}, {@code environmentId}). Any field not on the allowlist —
 * including a {@code credentials} key in ANY shape (map, nested map, list) at ANY
 * location — is simply never copied.
 */
final class IntegrationProjection {

    // Only these non-secret fields are copied into a response. Everything else
    // (credentials, conditions, deleted flags, timestamps, ...) is dropped.
    static final List<String> ALLOWED_FIELDS = List.of(
            "_id", "providerId", "channel", "name", "identifier",
            "active", "primary", "environmentId");

    private IntegrationProjection() {
    }

    /**
     * Build a fresh map containing ONLY the allowlisted, non-secret fields present
     * on the integration. Fields absent on a given integration are dropped rather
     * than invented; a present-but-null allowlisted field is copied as null.
     */
    static Map<String, Object> project(Map<String, Object> integration) {
        Map<String, Object> projected = new LinkedHashMap<>();
        if (integration == null) {
            return projected;
        }
        for (String field : ALLOWED_FIELDS) {
            if (integration.containsKey(field)) {
                projected.put(field, integration.get(field));
            }
        }
        return projected;
    }

    /** Novu returns {@code {data: [...]}}; be defensive about the envelope shape. */
    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> extractList(Map<String, Object> body) {
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
}
