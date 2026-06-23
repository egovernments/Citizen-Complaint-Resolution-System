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

import java.util.ArrayList;
import java.util.Collections;
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
        resolveRequest.put("criteria", Map.of(
            "eventName", eventName,
            "channel", context.getChannel(),  // Include channel in template resolution
            "locale", context.getLocale()     // Include locale in template resolution
        ));

        Map<String, Object> payload = new HashMap<>();
        payload.put("RequestInfo", new HashMap<>());
        payload.put("resolveRequest", resolveRequest);

        try {
            String url = config.getConfigHost() + config.getConfigResolvePath();
            log.info("Config resolve request: url={}, schemaCode=TemplateBinding, eventName={}, channel={}, locale={}, tenantId={}",
                    url, eventName, context.getChannel(), context.getLocale(), tenantId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new CustomException("NB_CONFIG_RESOLVE_FAILED", "Template resolve returned non-success response");
            }

            Map<String, Object> configData = (Map<String, Object>) response.getBody().get("configData");
            if (configData == null) {
                // Try fallback to default locale if specific locale not found
                log.warn("No config found for locale={}, attempting fallback to en_IN", context.getLocale());
                
                // Retry with default locale en_IN
                resolveRequest.put("criteria", Map.of(
                    "eventName", eventName,
                    "channel", context.getChannel(),
                    "locale", "en_IN"
                ));
                
                response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
                if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                    throw new CustomException("NB_CONFIG_RESOLVE_FAILED", "Template resolve failed even with default locale");
                }
                
                configData = (Map<String, Object>) response.getBody().get("configData");
                if (configData == null) {
                    throw new CustomException("NB_CONFIG_NOT_FOUND", "No config data found for event even with default locale");
                }
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
                    .contentSid(contentSid)
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
        resolveRequest.put("criteria", Map.of(
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
            String senderNumber = (String) data.get("senderNumber");

            log.info("Provider resolve result: provider={}, channel={}, credentialKeys={}, priority={}, isActive={}, senderNumber={}",
                    resolvedProvider, resolvedChannel, 
                    credentials != null ? credentials.keySet() : "null",
                    priority, isActive, senderNumber);

            return ResolvedProvider.builder()
                    .providerName(resolvedProvider)
                    .channel(resolvedChannel)
                    .credentials(credentials)
                    .novuApiKey(novuApiKey)
                    .isActive(isActive != null ? isActive : true)
                    .priority(priority != null ? priority : 0)
                    .senderNumber(senderNumber)
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
        Map<String, Object> searchCriteria = new HashMap<>();
        searchCriteria.put("schemaCode", "ProviderDetail");
        searchCriteria.put("tenantId", tenantId);
        searchCriteria.put("criteria", Map.of("channel", channel, "priority", 1));

        Map<String, Object> payload = new HashMap<>();
        payload.put("RequestInfo", new HashMap<>());
        payload.put("criteria", searchCriteria);

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
                Integer priority = (Integer) data.get("priority");
                String senderNumber = (String) data.get("senderNumber");

                providers.add(ResolvedProvider.builder()
                        .providerName(resolvedProvider)
                        .channel(resolvedChannel)
                        .credentials(credentials)
                        .novuApiKey(novuApiKey)
                        .isActive(isActive != null ? isActive : true)
                        .priority(priority != null ? priority : 999) // Default low priority
                        .senderNumber(senderNumber)
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

    /**
     * Tenant-level channel toggle. Resolves the NotificationChannel config for the given
     * tenant + channel and reports whether it is enabled.
     *
     * Defaults to DISABLED (returns false) when no record exists or the lookup fails, so a
     * channel is only ever dispatched when a tenant has explicitly opted in. NotificationChannel.code
     * is the uppercase enum (WHATSAPP/SMS/EMAIL); the dispatch channel is lowercase, so we normalise.
     */
    public boolean isChannelEnabled(String tenantId, String channel) {
        String code = channel == null ? "" : channel.toUpperCase();
        Map<String, Object> resolveRequest = new HashMap<>();
        resolveRequest.put("schemaCode", "NotificationChannel");
        resolveRequest.put("tenantId", tenantId);
        resolveRequest.put("criteria", Map.of("code", code));

        Map<String, Object> payload = new HashMap<>();
        payload.put("RequestInfo", new HashMap<>());
        payload.put("resolveRequest", resolveRequest);

        try {
            String url = config.getConfigHost() + config.getConfigResolvePath();
            log.info("Channel-enabled check: url={}, schemaCode=NotificationChannel, code={}, tenantId={}",
                    url, code, tenantId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                log.warn("Channel-enabled check returned non-success for tenant={} channel={}; treating as DISABLED",
                        tenantId, channel);
                return false;
            }

            Map<String, Object> configData = (Map<String, Object>) response.getBody().get("configData");
            if (configData == null) {
                // No NotificationChannel record for this tenant+channel -> default OFF.
                return false;
            }

            Map<String, Object> data = (Map<String, Object>) configData.get("data");
            boolean enabled = data != null && Boolean.TRUE.equals(data.get("enabled"));
            log.info("Channel-enabled result: tenantId={}, channel={}, enabled={}", tenantId, channel, enabled);
            return enabled;
        } catch (Exception e) {
            // Fail closed: config-service hiccups must never silently start sending on a channel.
            log.warn("Channel-enabled check failed for tenant={} channel={}; treating as DISABLED", tenantId, channel, e);
            return false;
        }
    }

    /**
     * Returns the lowercased channel codes the tenant has explicitly enabled (NotificationChannel
     * records with enabled=true). Defaults to an empty list (nothing enabled) when no records exist
     * or the lookup fails, so dispatch never fans out to a channel without an explicit opt-in.
     */
    public List<String> getEnabledChannels(String tenantId) {
        Map<String, Object> searchCriteria = new HashMap<>();
        searchCriteria.put("schemaCode", "NotificationChannel");
        searchCriteria.put("tenantId", tenantId);
        searchCriteria.put("criteria", Map.of("enabled", true));

        Map<String, Object> payload = new HashMap<>();
        payload.put("RequestInfo", new HashMap<>());
        payload.put("criteria", searchCriteria);

        try {
            String url = config.getConfigHost() + config.getConfigSearchPath();
            log.info("Enabled-channels search: url={}, schemaCode=NotificationChannel, tenantId={}", url, tenantId);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload), Map.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                log.warn("Enabled-channels search returned non-success for tenant={}; treating as none enabled", tenantId);
                return Collections.emptyList();
            }

            List<Map<String, Object>> configDataList = (List<Map<String, Object>>) response.getBody().get("configData");
            if (configDataList == null) {
                return Collections.emptyList();
            }

            List<String> channels = new ArrayList<>();
            for (Map<String, Object> configItem : configDataList) {
                Map<String, Object> data = (Map<String, Object>) configItem.get("data");
                if (data == null || !Boolean.TRUE.equals(data.get("enabled"))) {
                    continue;
                }
                Object code = data.get("code");
                if (code != null) {
                    channels.add(String.valueOf(code).toLowerCase());
                }
            }
            log.info("Enabled-channels result: tenantId={}, channels={}", tenantId, channels);
            return channels;
        } catch (Exception e) {
            // Fail closed: never fan out to channels we could not confirm are enabled.
            log.warn("Enabled-channels search failed for tenant={}; treating as none enabled", tenantId, e);
            return Collections.emptyList();
        }
    }
}
