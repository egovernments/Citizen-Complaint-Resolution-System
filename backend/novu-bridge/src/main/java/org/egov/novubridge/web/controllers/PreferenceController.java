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
 * Read-only proxy exposing per-user notification preferences to the
 * configurator's User Preferences screen. Sits alongside {@code DispatchController}
 * under the same {@code /novu-adapter/v1} namespace.
 *
 * <p><b>No PII, allowlist projection.</b> A preference record carries no PII: it
 * is keyed by an opaque {@code userId} uuid and holds only the user's
 * {@code preferredLanguage} and a per-channel {@code consent} map ({@code
 * {status, scope}} per channel — all non-secret). Even so, the response is built
 * by an ALLOWLIST projection rather than by denylisting: for each preference only
 * a fixed set of fields ({@code userId}, {@code tenantId}, {@code
 * preferredLanguage}, {@code consent}) is copied out. Anything else the
 * preference service might attach to a record is simply never copied, so nothing
 * unexpected can leak.
 *
 * <p><b>Observability boundary:</b> this lists the stored user preferences only.
 * It does not resolve mobile numbers, emails or any other subscriber identity —
 * those never cross this boundary.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
public class PreferenceController {

    // Only these non-secret, non-PII fields are copied into the response.
    // Everything else the preference service attaches to a record is dropped.
    // preferredLanguage and consent are lifted out of the record's payload.
    private static final List<String> ALLOWED_FIELDS = List.of("userId", "tenantId");
    private static final List<String> ALLOWED_PAYLOAD_FIELDS = List.of("preferredLanguage", "consent");

    private final PreferenceServiceClient preferenceServiceClient;

    public PreferenceController(PreferenceServiceClient preferenceServiceClient) {
        this.preferenceServiceClient = preferenceServiceClient;
    }

    /**
     * Return the user notification preferences as an allowlist projection.
     *
     * @return {@code {data:[preference...], total}} — read-only, non-secret,
     *         non-PII fields only.
     */
    @GetMapping("/preferences")
    public ResponseEntity<PreferenceListResponse> preferences(
            @RequestParam(name = "tenantId", required = false) String tenantId,
            @RequestParam(name = "limit", required = false, defaultValue = "100") int limit,
            @RequestParam(name = "offset", required = false, defaultValue = "0") int offset) {
        List<Map<String, Object>> preferences = preferenceServiceClient.listPreferences(tenantId, limit, offset);
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

    /**
     * Build a fresh map containing ONLY the allowlisted, non-secret, non-PII
     * fields present on the preference record. Top-level {@code userId}/{@code
     * tenantId} are copied as-is; {@code preferredLanguage} and {@code consent}
     * are lifted out of the record's {@code payload}. Any field not on an
     * allowlist is never copied; fields absent on a given record are dropped
     * rather than invented.
     */
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
