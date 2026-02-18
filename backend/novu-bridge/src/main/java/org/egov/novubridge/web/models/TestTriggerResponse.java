package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.response.ResponseInfo;

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TestTriggerResponse {
    private ResponseInfo responseInfo;
    private String status;
    private Integer novuStatusCode;
    private Map<String, Object> novuResponse;
}
