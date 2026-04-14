package org.egov.novubridge.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.request.RequestInfo;

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TestTriggerRequest {

    @JsonProperty("RequestInfo")
    @NotNull
    private RequestInfo requestInfo;

    @NotBlank
    private String templateKey;

    @NotBlank
    private String subscriberId;

    @NotNull
    private Map<String, Object> payload;

    private String transactionId;

    private String phone;

    private String contentSid;

    private Map<String, String> contentVariables;
}
