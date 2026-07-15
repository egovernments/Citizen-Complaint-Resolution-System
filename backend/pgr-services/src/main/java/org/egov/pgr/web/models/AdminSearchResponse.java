package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.response.ResponseInfo;

import java.util.List;

/**
 * Response of {@code POST /pgr-services/v2/request/_admin/_search}. Bundles the paginated rows
 * with the total match count (§12 of docs/complaint-search-page.md) in one call instead of the
 * existing two-call {@code _search} + {@code _count} pattern.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AdminSearchResponse {

    @JsonProperty("ResponseInfo")
    private ResponseInfo responseInfo;

    @JsonProperty("ServiceWrappers")
    private List<ServiceWrapper> serviceWrappers;

    @JsonProperty("totalCount")
    private Integer totalCount;
}
