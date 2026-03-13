package org.egov.novubridge.service;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.provider.NovuProviderStrategy;
import org.egov.novubridge.service.provider.NovuProviderStrategyFactory;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
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
    private final NovuProviderStrategyFactory providerStrategyFactory;

    public NovuClient(RestTemplate restTemplate, NovuBridgeConfiguration config, 
                     NovuProviderStrategyFactory providerStrategyFactory) {
        this.restTemplate = restTemplate;
        this.config = config;
        this.providerStrategyFactory = providerStrategyFactory;
    }

    public NovuResponse trigger(String templateKey, String subscriberId, String phone, Map<String, Object> payload,
                                String transactionId, Map<String, Object> overrides, String novuApiKey) {
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

            String apiKey = (novuApiKey != null && !novuApiKey.isBlank()) ? novuApiKey : config.getNovuApiKey();
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "ApiKey " + apiKey);
            headers.setContentType(MediaType.APPLICATION_JSON);

            String url = config.getNovuBaseUrl() + "/v1/events/trigger";
            
            log.info("=== NOVU PAYLOAD ===");
            log.info("URL: {}", url);
            log.info("Headers: {}", headers);
            log.info("Request Body: {}", request);
            log.info("==================");
            
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(request, headers), Map.class);
            return NovuResponse.builder()
                    .statusCode(response.getStatusCodeValue())
                    .response(response.getBody())
                    .build();
        } catch (Exception e) {
            log.error("Novu trigger failed for templateKey={} subscriberId={}", templateKey, subscriberId, e);
            log.error("Request was: templateKey={}, subscriberId={}, phone={}, payload={}, transactionId={}, overrides={}", 
                    templateKey, subscriberId, phone, payload, transactionId, overrides);
            throw new CustomException("NB_NOVU_TRIGGER_FAILED", "Failed triggering Novu event: " + e.getMessage());
        }
    }

    /**
     * Trigger notification with provider-agnostic configuration using strategy pattern
     * Automatically selects the correct provider strategy based on resolved configuration
     */
    public NovuResponse triggerWithProviderConfig(String templateKey, String subscriberId, String phone, 
                                                  Map<String, Object> payload, String transactionId,
                                                  ResolvedProvider resolvedProvider, ResolvedTemplate resolvedTemplate,
                                                  Map<String, String> contentVariables, String novuApiKey) {
        
        // Get the appropriate strategy for this provider
        NovuProviderStrategy strategy = providerStrategyFactory.getStrategy(resolvedProvider);
        
        // Build provider-specific configuration using the strategy
        Map<String, Object> providerConfig = strategy.buildProviderConfig(
            resolvedProvider, resolvedTemplate, contentVariables);
        
        // Create Novu overrides structure
        Map<String, Object> providerOverrides = new HashMap<>();
        if (providerConfig != null && !providerConfig.isEmpty()) {
            providerOverrides.put(resolvedProvider.getProviderName().toLowerCase(), providerConfig);
        }
        
        Map<String, Object> overrides = Map.of("providers", providerOverrides);
        
        log.info("Triggering Novu with provider config: templateKey={}, provider={}, strategy={}, credentialKeys={}, senderNumber={}, contentSid={}", 
                templateKey, resolvedProvider.getProviderName(), strategy.getClass().getSimpleName(),
                resolvedProvider.getCredentials() != null ? resolvedProvider.getCredentials().keySet() : "none", 
                resolvedProvider.getSenderNumber(), resolvedTemplate.getContentSid());
        
        return trigger(templateKey, subscriberId, phone, payload, transactionId, overrides, novuApiKey);
    }
    
    /**
     * @deprecated Use triggerWithProviderConfig instead for provider-agnostic support
     */
    @Deprecated
    public NovuResponse triggerWithProviderCredentials(String templateKey, String subscriberId, String phone, 
                                                       Map<String, Object> payload, String transactionId,
                                                       String providerName, Map<String, Object> providerCredentials,
                                                       String senderNumber, String contentSid, 
                                                       Map<String, String> contentVariables, String novuApiKey) {
        // For backward compatibility, create ResolvedProvider and ResolvedTemplate
        ResolvedProvider provider = ResolvedProvider.builder()
                .providerName(providerName)
                .credentials(providerCredentials)
                .senderNumber(senderNumber)
                .build();
                
        ResolvedTemplate template = ResolvedTemplate.builder()
                .contentSid(contentSid)
                .build();
        
        return triggerWithProviderConfig(templateKey, subscriberId, phone, payload, transactionId,
                provider, template, contentVariables, novuApiKey);
    }

    public NovuResponse trigger(String templateKey, String subscriberId, String phone, Map<String, Object> payload,
                                String transactionId, Map<String, Object> overrides) {
        return trigger(templateKey, subscriberId, phone, payload, transactionId, overrides, null);
    }

    public NovuResponse trigger(String templateKey, String subscriberId, Map<String, Object> payload, String transactionId) {
        return trigger(templateKey, subscriberId, null, payload, transactionId, null, null);
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
