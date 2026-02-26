package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
public class PreferenceServiceClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public PreferenceServiceClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    public boolean isWhatsAppAllowed(String tenantId, String userId, String mobile) {
        if (Boolean.FALSE.equals(config.getPreferenceEnabled())) {
            return true;
        }
        if (!StringUtils.hasText(userId)) {
            return false;
        }
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("requestInfo", new HashMap<>());
            payload.put("criteria", Map.of(
                    "userId", userId,
                    "tenantId", tenantId,
                    "preferenceCode", config.getPreferenceCode(),
                    "limit", 1,
                    "offset", 0
            ));

            String url = config.getPreferenceHost() + config.getPreferenceCheckPath();
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                return false;
            }
            List<Map<String, Object>> preferences = (List<Map<String, Object>>) response.getBody().get("preferences");
            if (preferences == null || preferences.isEmpty()) {
                return false;
            }

            Map<String, Object> pref = preferences.get(0);
            Map<String, Object> prefPayload = (Map<String, Object>) pref.get("payload");
            if (prefPayload == null) {
                return false;
            }
            Map<String, Object> consent = (Map<String, Object>) prefPayload.get("consent");
            if (consent == null) {
                return false;
            }
            Map<String, Object> whatsapp = (Map<String, Object>) consent.get("WHATSAPP");
            if (whatsapp == null) {
                return false;
            }
            String status = value(whatsapp.get("status"));
            String scope = value(whatsapp.get("scope"));
            String scopeTenant = value(whatsapp.get("tenantId"));

            if (!"GRANTED".equalsIgnoreCase(status)) {
                return false;
            }
//            if ("TENANT".equalsIgnoreCase(scope)) {
//                return tenantId.equalsIgnoreCase(scopeTenant);
//            }
            return true;
        } catch (Exception e) {
            log.warn("Preference check failed. tenantId={} userId={} mobile={}", tenantId, userId, mobile, e);
            return false;
        }
    }

    private String value(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
