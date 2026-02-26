package org.egov.config.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ProviderDetailRequest {

    @JsonProperty("RequestInfo")
    @NotNull
    @Valid
    private RequestInfo requestInfo;

    @JsonProperty("providerDetail")
    @NotNull
    @Valid
    private ProviderDetail providerDetail;
}
