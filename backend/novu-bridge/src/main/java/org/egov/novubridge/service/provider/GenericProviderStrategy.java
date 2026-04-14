package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;

/**
 * Generic fallback provider strategy for unknown providers
 * Uses a standard template format that works with most providers
 */
@Component
@Slf4j
public class GenericProviderStrategy implements NovuProviderStrategy {
    
    @Override
    public String getProviderName() {
        return "generic";
    }
    
    @Override
    public boolean supports(String providerName) {
        // Generic provider supports all unknown providers
        return true;
    }
    
    @Override
    public Map<String, Object> buildProviderConfig(ResolvedProvider resolvedProvider,
                                                  ResolvedTemplate resolvedTemplate,
                                                  Map<String, String> contentVariables) {
        Map<String, Object> config = new HashMap<>();
        
        // Add credentials from resolved provider
        if (resolvedProvider.getCredentials() != null && !resolvedProvider.getCredentials().isEmpty()) {
            config.put("credentials", resolvedProvider.getCredentials());
        }
        
        // Add sender number from resolved provider
        if (StringUtils.hasText(resolvedProvider.getSenderNumber())) {
            config.put("from", resolvedProvider.getSenderNumber());
            log.debug("Generic: Using senderNumber from config: {}", resolvedProvider.getSenderNumber());
        }
        
        // Add generic template configuration
        String contentSid = resolvedTemplate.getContentSid();
        if (StringUtils.hasText(contentSid)) {
            Map<String, Object> template = new HashMap<>();
            template.put("name", contentSid);
            
            // Add parameters in a generic format
            if (contentVariables != null && !contentVariables.isEmpty()) {
                template.put("parameters", contentVariables);
                log.debug("Generic: Using template parameters from paramOrder: {}", contentVariables);
            }
            
            config.put("template", template);
            log.debug("Generic: Using template name from config: {}", contentSid);
        }
        
        return config;
    }
    
    @Override
    public boolean isContentSidValid(String contentSid) {
        // Accept any non-empty string for generic providers
        return StringUtils.hasText(contentSid);
    }
    
    @Override
    public String[] getSupportedChannels() {
        return new String[]{"whatsapp", "sms", "email", "push"};
    }
}