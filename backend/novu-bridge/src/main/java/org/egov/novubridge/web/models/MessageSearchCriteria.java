package org.egov.novubridge.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageSearchCriteria {
    
    @JsonProperty("createdAtFrom")
    private Long createdAtFrom; // Timestamp in milliseconds
    
    @JsonProperty("createdAtTo")
    private Long createdAtTo; // Timestamp in milliseconds
    
    @JsonProperty("subscriberId")
    private String subscriberId;
    
    @JsonProperty("templateId")
    private String templateId;
    
    @JsonProperty("channel")
    private String channel;
    
    @JsonProperty("status")
    private String status;
    
    @JsonProperty("transactionId")
    private String transactionId;
    
    @JsonProperty("offset")
    @Builder.Default
    private Integer offset = 0; // Skip
    
    @JsonProperty("limit")
    @Builder.Default
    private Integer limit = 10; // Limit
}
