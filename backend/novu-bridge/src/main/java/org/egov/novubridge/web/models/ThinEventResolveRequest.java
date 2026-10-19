package org.egov.novubridge.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.request.RequestInfo;

/** Body of {@code POST /novu-adapter/v1/dispatch/_resolve}: one thin event to resolve, dry. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ThinEventResolveRequest {

    @JsonProperty("RequestInfo")
    @NotNull
    private RequestInfo requestInfo;

    @NotNull
    @Valid
    private ThinEvent event;
}
