package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.provider.ProviderCatalog;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ALLOWLIST projection for Novu integrations, shared by the list and provider endpoints: the
 * response is rebuilt from fixed non-secret fields, so {@code credentials} in any shape at any
 * location is never copied.
 */
final class IntegrationProjection {

    static final List<String> ALLOWED_FIELDS = List.of(
            "_id", "providerId", "channel", "name", "identifier",
            "active", "primary", "environmentId");

    private IntegrationProjection() {
    }

    /** Only allowlisted fields that are present; absent ones are not invented. */
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

    /** Plus the derived catalog {@code type}, and {@code active}/{@code primary} as real booleans (Novu omits them). */
    static Map<String, Object> projectListItem(Map<String, Object> integration) {
        Map<String, Object> projected = project(integration);
        projected.put("active", integration != null && Boolean.TRUE.equals(integration.get("active")));
        projected.put("primary", integration != null && Boolean.TRUE.equals(integration.get("primary")));
        projected.put("type", ProviderCatalog.deriveType(integration));
        return projected;
    }

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
