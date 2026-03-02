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
        log.info("Preference check: tenantId={}, userId={}, mobile={}, preferenceEnabled={}",
                tenantId, userId, mobile, config.getPreferenceEnabled());

        if (Boolean.FALSE.equals(config.getPreferenceEnabled())) {
            log.info("Preference check disabled, allowing by default");
            return true;
        }
        if (!StringUtils.hasText(userId)) {
            log.warn("Preference check denied: userId is blank. tenantId={}, mobile={}", tenantId, mobile);
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
            log.info("Preference request: url={}, preferenceCode={}, userId={}, tenantId={}",
                    url, config.getPreferenceCode(), userId, tenantId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            log.info("Preference response: statusCode={}, body={}", response.getStatusCode(), response.getBody());

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                log.warn("Preference check denied: non-success response. statusCode={}", response.getStatusCode());
                return false;
            }
            List<Map<String, Object>> preferences = (List<Map<String, Object>>) response.getBody().get("preferences");
            if (preferences == null || preferences.isEmpty()) {
                log.warn("Preference check denied: no preferences found for userId={}, tenantId={}", userId, tenantId);
                return false;
            }

            Map<String, Object> pref = preferences.get(0);
            Map<String, Object> prefPayload = (Map<String, Object>) pref.get("payload");
            if (prefPayload == null) {
                log.warn("Preference check denied: preference payload is null. pref={}", pref);
                return false;
            }
            Map<String, Object> consent = (Map<String, Object>) prefPayload.get("consent");
            if (consent == null) {
                log.warn("Preference check denied: consent block is null. prefPayload={}", prefPayload);
                return false;
            }
            Map<String, Object> whatsapp = (Map<String, Object>) consent.get("WHATSAPP");
            if (whatsapp == null) {
                log.warn("Preference check denied: WHATSAPP consent not found. consent={}", consent);
                return false;
            }
            String status = value(whatsapp.get("status"));
            String scope = value(whatsapp.get("scope"));
            String scopeTenant = value(whatsapp.get("tenantId"));

            log.info("Preference WHATSAPP consent: status={}, scope={}, scopeTenant={}", status, scope, scopeTenant);

            if (!"GRANTED".equalsIgnoreCase(status)) {
                log.warn("Preference check denied: status is not GRANTED. status={}", status);
                return false;
            }
//            if ("TENANT".equalsIgnoreCase(scope)) {
//                return tenantId.equalsIgnoreCase(scopeTenant);
//            }
            log.info("Preference check allowed for userId={}, tenantId={}", userId, tenantId);
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
