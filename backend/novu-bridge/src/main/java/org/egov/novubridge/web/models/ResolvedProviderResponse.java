package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResolvedProviderResponse {
    private String providerName;
    private String channel;
    private Boolean isActive;
    private Integer priority;
    private String senderNumber;
    
    public static ResolvedProviderResponse fromInternal(ResolvedProvider provider) {
        if (provider == null) {
            return null;
        }
        return ResolvedProviderResponse.builder()
                .providerName(provider.getProviderName())
                .channel(provider.getChannel())
                .isActive(provider.getIsActive())
                .priority(provider.getPriority())
                .senderNumber(provider.getSenderNumber())
                .build();
    }
}