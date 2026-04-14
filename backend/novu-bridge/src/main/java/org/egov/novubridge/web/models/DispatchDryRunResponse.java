package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.response.ResponseInfo;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DispatchDryRunResponse {
    private ResponseInfo responseInfo;
    private DispatchResult result;
}
