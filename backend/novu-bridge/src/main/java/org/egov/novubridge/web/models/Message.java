package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.Date;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "messages")
public class Message {
    
    @Id
    private String id;
    
    private Date createdAt;
    
    private Date updatedAt;
    
    private String subscriberId;
    
    private String templateId;
    
    private String channel;
    
    private String status;
    
    private String transactionId;
    
    private Map<String, Object> payload;
    
    private Map<String, Object> content;
    
    private String providerId;
    
    private String providerResponse;
    
    private String errorText;
}
