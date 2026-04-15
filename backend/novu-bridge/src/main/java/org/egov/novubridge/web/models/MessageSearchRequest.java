package org.egov.novubridge.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.request.RequestInfo;

import jakarta.validation.Valid;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageSearchRequest {
    
    @JsonProperty("RequestInfo")
    @Valid
    private RequestInfo requestInfo;
    
    @JsonProperty("criteria")
    @Valid
    private MessageSearchCriteria criteria;
}
