package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.PreferenceServiceClient;
import org.egov.novubridge.web.models.PreferenceListResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only User Preferences screen. ALLOWLIST projection: only userId, tenantId and the payload's
 * preferredLanguage/consent are copied; no subscriber identity crosses this boundary.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
public class PreferenceController {

    private static final List<String> ALLOWED_FIELDS = List.of("userId", "tenantId");
    private static final List<String> ALLOWED_PAYLOAD_FIELDS = List.of("preferredLanguage", "consent");

    private final PreferenceServiceClient preferenceServiceClient;

    public PreferenceController(PreferenceServiceClient preferenceServiceClient) {
        this.preferenceServiceClient = preferenceServiceClient;
    }

    @GetMapping("/preferences")
    public ResponseEntity<PreferenceListResponse> preferences(
            @RequestParam(name = "tenantId", required = false) String tenantId,
            @RequestParam(name = "limit", required = false, defaultValue = "100") int limit,
            @RequestParam(name = "offset", required = false, defaultValue = "0") int offset) {
        // Clamped so a huge limit cannot force an unbounded read from the preference service.
        int boundedLimit = Math.max(1, Math.min(limit, 500));
        List<Map<String, Object>> preferences = preferenceServiceClient.listPreferences(tenantId, boundedLimit, offset);
        List<Map<String, Object>> projected = new ArrayList<>(preferences.size());
        for (Map<String, Object> preference : preferences) {
            projected.add(projectAllowedFields(preference));
        }
        PreferenceListResponse response = PreferenceListResponse.builder()
                .data(projected)
                .total((long) projected.size())
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> projectAllowedFields(Map<String, Object> preference) {
        Map<String, Object> projected = new LinkedHashMap<>();
        for (String field : ALLOWED_FIELDS) {
            if (preference.containsKey(field)) {
                projected.put(field, preference.get(field));
            }
        }
        Object payload = preference.get("payload");
        if (payload instanceof Map) {
            Map<String, Object> payloadMap = (Map<String, Object>) payload;
            for (String field : ALLOWED_PAYLOAD_FIELDS) {
                if (payloadMap.containsKey(field)) {
                    projected.put(field, payloadMap.get(field));
                }
            }
        }
        return projected;
    }
}
