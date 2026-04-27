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
public class UserServiceClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public UserServiceClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    public String resolveUserUuid(String tenantId, String audience, String userId, String mobile) {
        if (StringUtils.hasText(userId)) {
            return userId;
        }
        if (!StringUtils.hasText(mobile)) {
            return null;
        }

        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("RequestInfo", new HashMap<>());
            payload.put("tenantId", tenantId);
            payload.put("userType", toUserType(audience));
            payload.put("userName", mobile);

            String url = config.getUserHost() + config.getUserSearchPath();
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                return null;
            }

            List<Map<String, Object>> users = (List<Map<String, Object>>) response.getBody().get("user");
            if (users == null || users.isEmpty()) {
                return null;
            }
            Object uuid = users.get(0).get("uuid");
            return uuid == null ? null : String.valueOf(uuid);
        } catch (Exception e) {
            log.warn("User uuid resolve failed tenantId={} audience={} mobile={}", tenantId, audience, mobile, e);
            return null;
        }
    }

    private String toUserType(String audience) {
        if ("EMPLOYEE".equalsIgnoreCase(audience)) {
            return "EMPLOYEE";
        }
        return "CITIZEN";
    }
}

