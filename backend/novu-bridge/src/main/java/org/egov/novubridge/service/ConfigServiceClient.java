package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.DerivedContext;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
public class ConfigServiceClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public ConfigServiceClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    public ResolvedTemplate resolveTemplate(DerivedContext context, String eventName, String module, String tenantId) {
        Map<String, Object> resolveRequest = new HashMap<>();
        resolveRequest.put("eventName", eventName);
        resolveRequest.put("tenantId", tenantId);

        Map<String, Object> payload = new HashMap<>();
        payload.put("RequestInfo", new HashMap<>());
        payload.put("resolveRequest", resolveRequest);

        try {
            String url = config.getConfigHost() + config.getConfigResolvePath();
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new CustomException("NB_CONFIG_RESOLVE_FAILED", "Template resolve returned non-success response");
            }
            Map<String, Object> binding = (Map<String, Object>) response.getBody().get("templateBinding");
            if (binding == null) {
                throw new CustomException("NB_CONFIG_NOT_FOUND", "No template binding found for event");
            }

            String templateId = (String) binding.get("templateId");
            String contentSid = (String) binding.get("contentSid");
            List<String> paramOrder = (List<String>) binding.get("paramOrder");
            List<String> requiredVars = (List<String>) binding.get("requiredVars");

            // Extract novuApiKey from providerDetail.value if available
            String novuApiKey = null;
            Map<String, Object> providerDetail = (Map<String, Object>) binding.get("providerDetail");
            if (providerDetail != null && providerDetail.get("value") instanceof Map) {
                novuApiKey = (String) ((Map<String, Object>) providerDetail.get("value")).get("novuApiKey");
            }

            return ResolvedTemplate.builder()
                    .templateKey(templateId)
                    .twilioContentSid(contentSid)
                    .paramOrder(paramOrder)
                    .requiredVars(requiredVars)
                    .novuApiKey(novuApiKey)
                    .build();
        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            log.error("Config resolve failed for eventName={} module={} tenantId={}", eventName, module, tenantId, e);
            throw new CustomException("NB_CONFIG_RESOLVE_FAILED", "Failed resolving template config");
        }
    }
}
