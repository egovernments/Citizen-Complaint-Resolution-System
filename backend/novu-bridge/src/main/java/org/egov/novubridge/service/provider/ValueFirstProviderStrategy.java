package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;

/**
 * ValueFirst provider strategy for SMS and WhatsApp messaging
 * Supports ValueFirst's API format and parameter structure
 */
@Component
@Slf4j
public class ValueFirstProviderStrategy implements NovuProviderStrategy {
    
    @Override
    public String getProviderName() {
        return "valuefirst";
    }
    
    @Override
    public boolean supports(String providerName) {
        return "valuefirst".equalsIgnoreCase(providerName) || "vf".equalsIgnoreCase(providerName);
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
        
        // Add sender from resolved provider - ValueFirst uses 'from' field
        if (StringUtils.hasText(resolvedProvider.getSenderNumber())) {
            String senderNumber = resolvedProvider.getSenderNumber();
            config.put("from", senderNumber);
            log.debug("ValueFirst: Using senderNumber from config: {}", senderNumber);
        }
        
        // Add ValueFirst-specific template configuration using _passthrough
        String templateId = resolvedTemplate.getContentSid();
        if (StringUtils.hasText(templateId)) {
            Map<String, Object> body = new HashMap<>();
            body.put("templateId", templateId);
            
            // Add template variables as object (ValueFirst format)
            if (contentVariables != null && !contentVariables.isEmpty()) {
                Map<String, Object> templateVars = new HashMap<>();
                
                // Convert content variables to ValueFirst format
                for (Map.Entry<String, String> entry : contentVariables.entrySet()) {
                    String key = entry.getKey();
                    String value = entry.getValue();
                    
                    // ValueFirst expects variables as {var1, var2, var3...}
                    templateVars.put("var" + key, value);
                }
                
                body.put("templateVars", templateVars);
                log.debug("ValueFirst: Using templateVars from paramOrder: {}", templateVars);
            }
            
            Map<String, Object> passthrough = new HashMap<>();
            passthrough.put("body", body);
            config.put("_passthrough", passthrough);
            
            log.debug("ValueFirst: Using templateId from template: {}", templateId);
        }
        
        return config;
    }
    
    @Override
    public boolean isContentSidValid(String contentSid) {
        // ValueFirst template IDs are typically alphanumeric strings
        if (!StringUtils.hasText(contentSid)) {
            return false;
        }
        // Accept any non-empty string as valid for ValueFirst
        return contentSid.length() > 0 && contentSid.matches("^[a-zA-Z0-9_-]+$");
    }
    
    @Override
    public String[] getSupportedChannels() {
        return new String[]{"sms", "whatsapp"};
    }
}