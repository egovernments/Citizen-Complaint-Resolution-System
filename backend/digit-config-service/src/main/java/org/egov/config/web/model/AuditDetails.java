package org.egov.config.web.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
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
