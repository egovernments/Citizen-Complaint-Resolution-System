package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;

/**
 * Vonage (formerly Nexmo) provider strategy for WhatsApp Business API
 * Uses Vonage's template.name and template.parameters format
 */
@Component
@Slf4j
public class VonageProviderStrategy implements NovuProviderStrategy {
    
    @Override
    public String getProviderName() {
        return "vonage";
    }
    
    @Override
    public boolean supports(String providerName) {
        return "vonage".equalsIgnoreCase(providerName) || "nexmo".equalsIgnoreCase(providerName);
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
            log.debug("Vonage: Using senderNumber from config: {}", resolvedProvider.getSenderNumber());
        }
        
        // Add Vonage-specific template configuration
        String contentSid = resolvedTemplate.getContentSid();
        if (StringUtils.hasText(contentSid)) {
            Map<String, Object> template = new HashMap<>();
            template.put("name", contentSid);
            
            // Add parameters (Vonage uses key-value pairs directly)
            if (contentVariables != null && !contentVariables.isEmpty()) {
                Map<String, Object> parameters = new HashMap<>();
                contentVariables.forEach((key, value) -> parameters.put(key, value));
                template.put("parameters", parameters);
                log.debug("Vonage: Using template parameters from paramOrder: {}", parameters);
            }
            
            config.put("template", template);
            log.debug("Vonage: Using template name from config: {}", contentSid);
        }
        
        return config;
    }
    
    @Override
    public boolean isContentSidValid(String contentSid) {
        // Vonage template names can be alphanumeric with underscores/hyphens
        return StringUtils.hasText(contentSid) && contentSid.matches("^[a-zA-Z0-9_-]+$");
    }
    
    @Override
    public String[] getSupportedChannels() {
        return new String[]{"whatsapp", "sms", "voice"};
    }
}