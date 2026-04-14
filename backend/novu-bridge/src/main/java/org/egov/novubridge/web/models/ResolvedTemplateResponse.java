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
public class ResolvedTemplateResponse {
    private String templateKey;
    private String templateVersion;
    private String contentSid;
    private List<String> requiredVars;
    private List<String> optionalVars;
    private List<String> paramOrder;
    private String fallbackTemplateKey;
    private String fallbackTemplateVersion;
    
    public static ResolvedTemplateResponse fromInternal(ResolvedTemplate template) {
        if (template == null) {
            return null;
        }
        return ResolvedTemplateResponse.builder()
                .templateKey(template.getTemplateKey())
                .templateVersion(template.getTemplateVersion())
                .contentSid(template.getContentSid())
                .requiredVars(template.getRequiredVars())
                .optionalVars(template.getOptionalVars())
                .paramOrder(template.getParamOrder())
                .fallbackTemplateKey(template.getFallbackTemplateKey())
                .fallbackTemplateVersion(template.getFallbackTemplateVersion())
                .build();
    }
}