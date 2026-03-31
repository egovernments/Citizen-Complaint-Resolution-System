package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Factory to select the appropriate provider strategy based on resolved provider configuration
 */
@Component
@Slf4j
public class NovuProviderStrategyFactory {
    
    private final List<NovuProviderStrategy> strategies;
    private final GenericProviderStrategy genericStrategy;
    
    public NovuProviderStrategyFactory(List<NovuProviderStrategy> strategies,
                                      GenericProviderStrategy genericStrategy) {
        this.strategies = strategies;
        this.genericStrategy = genericStrategy;
    }
    
    /**
     * Get the appropriate strategy for the given provider
     * 
     * @param resolvedProvider Provider configuration from config service
     * @return Provider strategy, defaults to generic if no specific strategy found
     */
    public NovuProviderStrategy getStrategy(ResolvedProvider resolvedProvider) {
        String providerName = resolvedProvider.getProviderName();
        
        log.debug("Finding strategy for provider: {}", providerName);
        
        // Find specific strategy that supports this provider
        NovuProviderStrategy strategy = strategies.stream()
                .filter(s -> !s.getClass().equals(GenericProviderStrategy.class)) // Skip generic in first pass
                .filter(s -> s.supports(providerName))
                .findFirst()
                .orElse(null);
                
        if (strategy != null) {
            log.info("Using specific strategy for provider {}: {}", providerName, strategy.getClass().getSimpleName());
            return strategy;
        }
        
        // Fallback to generic strategy
        log.info("No specific strategy found for provider {}, using generic strategy", providerName);
        return genericStrategy;
    }
    
    /**
     * Get strategy by provider name (for testing/debugging)
     */
    public NovuProviderStrategy getStrategyByName(String providerName) {
        return strategies.stream()
                .filter(s -> s.supports(providerName))
                .findFirst()
                .orElse(genericStrategy);
    }
    
    /**
     * List all available provider strategies
     */
    public List<String> getAvailableProviders() {
        return strategies.stream()
                .filter(s -> !s.getClass().equals(GenericProviderStrategy.class))
                .map(NovuProviderStrategy::getProviderName)
                .toList();
    }
}