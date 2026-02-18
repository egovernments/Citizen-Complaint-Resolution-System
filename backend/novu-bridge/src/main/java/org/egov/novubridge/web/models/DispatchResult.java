package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DispatchResult {
    private Boolean valid;
    private Boolean preferenceAllowed;
    private DerivedContext derivedContext;
    private ResolvedTemplate resolvedTemplate;
    private List<String> missingRequiredVars;
    private Boolean novuTriggered;
    private Integer novuStatusCode;
    private Map<String, Object> novuResponse;
    private List<String> diagnostics;
}
