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
        Map<String, Object> selectors = new HashMap<>();
        selectors.put("eventName", eventName);
        selectors.put("audience", context.getAudience());
        selectors.put("workflowState", context.getWorkflowState());
        selectors.put("channel", context.getChannel());

        Map<String, Object> resolveRequest = new HashMap<>();
        resolveRequest.put("configCode", "NOTIF_TEMPLATE_MAP");
        resolveRequest.put("module", module);
        resolveRequest.put("tenantId", tenantId);
        resolveRequest.put("locale", context.getLocale());
        resolveRequest.put("selectors", selectors);

        Map<String, Object> payload = new HashMap<>();
        payload.put("requestInfo", new HashMap<>());
        payload.put("resolveRequest", resolveRequest);

        try {
            String url = config.getConfigHost() + config.getConfigResolvePath();
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new CustomException("NB_CONFIG_RESOLVE_FAILED", "Template resolve returned non-success response");
            }
            Map<String, Object> resolved = (Map<String, Object>) response.getBody().get("resolved");
            if (resolved == null) {
                throw new CustomException("NB_CONFIG_NOT_FOUND", "No template mapping found for event");
            }
            Map<String, Object> value = (Map<String, Object>) resolved.get("value");
            if (value == null) {
                throw new CustomException("NB_CONFIG_NOT_FOUND", "Resolved mapping does not contain value object");
            }
            return ResolvedTemplate.builder()
                    .templateKey((String) value.get("templateKey"))
                    .templateVersion((String) value.get("templateVersion"))
                    .twilioContentSid((String) value.get("twilioContentSid"))
                    .requiredVars((List<String>) value.get("requiredVars"))
                    .optionalVars((List<String>) value.get("optionalVars"))
                    .paramOrder((List<String>) value.get("paramOrder"))
                    .fallbackTemplateKey((String) value.get("fallbackTemplateKey"))
                    .fallbackTemplateVersion((String) value.get("fallbackTemplateVersion"))
                    .build();
        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            log.error("Config resolve failed for eventName={} module={} tenantId={}", eventName, module, tenantId, e);
            throw new CustomException("NB_CONFIG_RESOLVE_FAILED", "Failed resolving template config");
        }
    }
}
