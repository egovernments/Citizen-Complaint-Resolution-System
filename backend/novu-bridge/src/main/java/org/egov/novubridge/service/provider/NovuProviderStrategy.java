package org.egov.novubridge.service.provider;

import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;

import java.util.Map;

/**
 * Strategy interface for different notification providers
 * Each provider implements this to define their specific Novu payload structure
 */
public interface NovuProviderStrategy {
    
    /**
     * Get the provider name (should match the provider name in config)
     */
    String getProviderName();
    
    /**
     * Check if this strategy supports the given provider name
     */
    boolean supports(String providerName);
    
    /**
     * Build the provider-specific configuration for Novu overrides
     * 
     * @param resolvedProvider Provider configuration from config service
     * @param resolvedTemplate Template configuration from config service  
     * @param contentVariables Ordered template variables from paramOrder
     * @return Provider configuration map for Novu overrides
     */
    Map<String, Object> buildProviderConfig(ResolvedProvider resolvedProvider,
                                           ResolvedTemplate resolvedTemplate,
                                           Map<String, String> contentVariables);
                                           
    /**
     * Validate if the contentSid format is valid for this provider
     */
    boolean isContentSidValid(String contentSid);
    
    /**
     * Get supported channels for this provider (whatsapp, sms, email, etc.)
     */
    String[] getSupportedChannels();
}