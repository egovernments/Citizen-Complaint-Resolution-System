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
public class Pagination {

    @JsonProperty("totalCount")
    private Long totalCount;

    @JsonProperty("limit")
    private Integer limit;

    @JsonProperty("offSet")
    private Integer offSet;
}
