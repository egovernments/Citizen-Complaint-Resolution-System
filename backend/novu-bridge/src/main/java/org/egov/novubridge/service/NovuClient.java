package org.egov.novubridge.service;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.tracer.model.CustomException;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

@Service
@Slf4j
public class NovuClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public NovuClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    public NovuResponse trigger(String templateKey, String subscriberId, String phone, Map<String, Object> payload,
                                String transactionId, Map<String, Object> overrides) {
        try {
            Map<String, Object> request = new HashMap<>();
            request.put("name", templateKey);
            Map<String, Object> to = new HashMap<>();
            to.put("subscriberId", subscriberId);
            if (phone != null && !phone.isBlank()) {
                to.put("phone", phone);
            }
            request.put("to", to);
            request.put("payload", payload);
            request.put("transactionId", transactionId);
            if (overrides != null && !overrides.isEmpty()) {
                request.put("overrides", overrides);
            }

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "ApiKey " + config.getNovuApiKey());
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = config.getNovuBaseUrl() + "/v1/events/trigger";
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(request, headers), Map.class);
            return NovuResponse.builder()
                    .statusCode(response.getStatusCodeValue())
                    .response(response.getBody())
                    .build();
        } catch (Exception e) {
            log.error("Novu trigger failed for templateKey={} subscriberId={}", templateKey, subscriberId, e);
            throw new CustomException("NB_NOVU_TRIGGER_FAILED", "Failed triggering Novu event");
        }
    }

    public NovuResponse trigger(String templateKey, String subscriberId, Map<String, Object> payload, String transactionId) {
        return trigger(templateKey, subscriberId, null, payload, transactionId, null);
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NovuResponse {
        private Integer statusCode;
        private Map<String, Object> response;
    }
}
