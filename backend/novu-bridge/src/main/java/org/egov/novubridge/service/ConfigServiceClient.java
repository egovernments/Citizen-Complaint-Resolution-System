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
        resolveRequest.put("schemaCode", "TemplateBinding");
        resolveRequest.put("tenantId", tenantId);
        resolveRequest.put("filters", Map.of("eventName", eventName));

        Map<String, Object> payload = new HashMap<>();
        payload.put("RequestInfo", new HashMap<>());
        payload.put("resolveRequest", resolveRequest);

        try {
            String url = config.getConfigHost() + config.getConfigResolvePath();
            log.info("Config resolve request: url={}, schemaCode=TemplateBinding, eventName={}, tenantId={}",
                    url, eventName, tenantId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new CustomException("NB_CONFIG_RESOLVE_FAILED", "Template resolve returned non-success response");
            }

            Map<String, Object> configData = (Map<String, Object>) response.getBody().get("configData");
            if (configData == null) {
                throw new CustomException("NB_CONFIG_NOT_FOUND", "No config data found for event");
            }

            Map<String, Object> data = (Map<String, Object>) configData.get("data");
            if (data == null) {
                throw new CustomException("NB_CONFIG_NOT_FOUND", "Config data payload is empty");
            }

            String templateId = (String) data.get("templateId");
            String contentSid = (String) data.get("contentSid");
            List<String> paramOrder = (List<String>) data.get("paramOrder");
            List<String> requiredVars = (List<String>) data.get("requiredVars");
            String novuApiKey = (String) data.get("novuApiKey");

            log.info("Config resolve result: templateId={}, contentSid={}, paramOrder={}, novuApiKey={}",
                    templateId, contentSid, paramOrder, novuApiKey != null ? "***" : "null");

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
