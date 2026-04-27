package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DerivedContext {
    private String channel;
    private String audience;
    private String workflowState;
    private String locale;
    private String recipientMobile;
    private String recipientUserId;
}
