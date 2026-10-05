package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Audit trail carried on every stored preference. */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public class AuditDetails {

    @JsonProperty("createdBy")
    private String createdBy;

    @JsonProperty("createdTime")
    private Long createdTime;

    @JsonProperty("lastModifiedBy")
    private String lastModifiedBy;

    @JsonProperty("lastModifiedTime")
    private Long lastModifiedTime;
}
