package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResolvedTemplate {
    private String templateKey;
    private String templateVersion;
    private String twilioContentSid;
    private List<String> requiredVars;
    private List<String> optionalVars;
    private List<String> paramOrder;
    private String fallbackTemplateKey;
    private String fallbackTemplateVersion;
    private String novuApiKey;
}
