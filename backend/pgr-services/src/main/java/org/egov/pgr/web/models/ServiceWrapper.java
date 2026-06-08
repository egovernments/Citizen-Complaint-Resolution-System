package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import lombok.*;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ServiceWrapper {

    @Valid
    @NonNull
    @JsonProperty("service")
    private Service service;

    @Valid
    @JsonProperty("workflow")
    private Workflow workflow;
}
