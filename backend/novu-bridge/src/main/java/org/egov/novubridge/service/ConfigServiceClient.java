package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.DerivedContext;
import org.egov.novubridge.web.models.ResolvedProvider;
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
        resolveRequest.put("filters", Map.of(
            "eventName", eventName,
            "channel", context.getChannel()  // Include channel in template resolution
        ));

        Map<String, Object> payload = new HashMap<>();
        payload.put("RequestInfo", new HashMap<>());
        payload.put("resolveRequest", resolveRequest);

        try {
            String url = config.getConfigHost() + config.getConfigResolvePath();
            log.info("Config resolve request: url={}, schemaCode=TemplateBinding, eventName={}, channel={}, tenantId={}",
                    url, eventName, context.getChannel(), tenantId);

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

    public ResolvedProvider resolveProvider(String tenantId, String providerName, String channel) {
        Map<String, Object> resolveRequest = new HashMap<>();
        resolveRequest.put("schemaCode", "ProviderDetail");
        resolveRequest.put("tenantId", tenantId);
        resolveRequest.put("filters", Map.of(
            "providerName", providerName,
            "channel", channel
        ));

        Map<String, Object> payload = new HashMap<>();
        payload.put("RequestInfo", new HashMap<>());
        payload.put("resolveRequest", resolveRequest);

        try {
            String url = config.getConfigHost() + config.getConfigResolvePath();
            log.info("Provider resolve request: url={}, schemaCode=ProviderDetail, providerName={}, channel={}, tenantId={}",
                    url, providerName, channel, tenantId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new CustomException("NB_PROVIDER_RESOLVE_FAILED", "Provider resolve returned non-success response");
            }

            Map<String, Object> configData = (Map<String, Object>) response.getBody().get("configData");
            if (configData == null) {
                throw new CustomException("NB_PROVIDER_NOT_FOUND", "No provider config found");
            }

            Map<String, Object> data = (Map<String, Object>) configData.get("data");
            if (data == null) {
                throw new CustomException("NB_PROVIDER_NOT_FOUND", "Provider config data payload is empty");
            }

            String resolvedProvider = (String) data.get("providerName");
            String resolvedChannel = (String) data.get("channel");
            Map<String, Object> credentials = (Map<String, Object>) data.get("credentials");
            String novuApiKey = (String) data.get("novuApiKey");
            Boolean isActive = (Boolean) data.get("isActive");
            Integer priority = (Integer) data.get("priority");

            log.info("Provider resolve result: provider={}, channel={}, credentialKeys={}, priority={}, isActive={}",
                    resolvedProvider, resolvedChannel, 
                    credentials != null ? credentials.keySet() : "null",
                    priority, isActive);

            return ResolvedProvider.builder()
                    .providerName(resolvedProvider)
                    .channel(resolvedChannel)
                    .credentials(credentials)
                    .novuApiKey(novuApiKey)
                    .isActive(isActive != null ? isActive : true)
                    .priority(priority != null ? priority : 0)
                    .build();
        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            log.error("Provider resolve failed for providerName={} channel={} tenantId={}", providerName, channel, tenantId, e);
            throw new CustomException("NB_PROVIDER_RESOLVE_FAILED", "Failed resolving provider config");
        }
    }

    /**
     * Resolve providers by tenant and channel only (no specific provider name)
     * Returns all active providers sorted by priority
     */
    public List<ResolvedProvider> resolveProvidersByChannel(String tenantId, String channel) {
        Map<String, Object> resolveRequest = new HashMap<>();
        resolveRequest.put("schemaCode", "ProviderDetail");
        resolveRequest.put("tenantId", tenantId);
        resolveRequest.put("filters", Map.of("channel", channel));

        Map<String, Object> payload = new HashMap<>();
        payload.put("RequestInfo", new HashMap<>());
        payload.put("resolveRequest", resolveRequest);

        try {
            String url = config.getConfigHost() + config.getConfigResolvePath().replace("_resolve", "_search");
            log.info("Provider search request: url={}, schemaCode=ProviderDetail, channel={}, tenantId={}",
                    url, channel, tenantId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new CustomException("NB_PROVIDER_SEARCH_FAILED", "Provider search returned non-success response");
            }

            List<Map<String, Object>> configDataList = (List<Map<String, Object>>) response.getBody().get("configData");
            if (configDataList == null || configDataList.isEmpty()) {
                throw new CustomException("NB_PROVIDERS_NOT_FOUND", "No provider configs found for channel");
            }

            List<ResolvedProvider> providers = new ArrayList<>();
            for (Map<String, Object> configItem : configDataList) {
                Map<String, Object> data = (Map<String, Object>) configItem.get("data");
                if (data == null) continue;

                String resolvedProvider = (String) data.get("providerName");
                String resolvedChannel = (String) data.get("channel");
                Map<String, Object> credentials = (Map<String, Object>) data.get("credentials");
                String novuApiKey = (String) data.get("novuApiKey");
                Boolean isActive = (Boolean) configItem.get("isActive");
                Integer priority = (Integer) configItem.get("priority");

                providers.add(ResolvedProvider.builder()
                        .providerName(resolvedProvider)
                        .channel(resolvedChannel)
                        .credentials(credentials)
                        .novuApiKey(novuApiKey)
                        .isActive(isActive != null ? isActive : true)
                        .priority(priority != null ? priority : 999) // Default low priority
                        .build());
            }

            log.info("Provider search result: found {} providers for channel={}, tenantId={}",
                    providers.size(), channel, tenantId);

            return providers;
        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            log.error("Provider search failed for channel={} tenantId={}", channel, tenantId, e);
            throw new CustomException("NB_PROVIDER_SEARCH_FAILED", "Failed searching provider configs");
        }
    }
}
