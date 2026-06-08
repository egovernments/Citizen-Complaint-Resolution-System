package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CountResponse {

    @JsonProperty("count")
    private Integer count;
}
