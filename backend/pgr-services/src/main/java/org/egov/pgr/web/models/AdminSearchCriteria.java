package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.validator.constraints.SafeHtml;

import java.util.Set;

/**
 * Query params for {@code POST /pgr-services/v2/request/_admin/_search} — the SUPERUSER
 * cross-department complaint search (see docs/complaint-search-page.md). Kept separate from
 * {@link RequestSearchCriteria} so this new, additive endpoint's contract can evolve without
 * touching the existing {@code _search}/{@code _count} APIs or their callers.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AdminSearchCriteria {

    @SafeHtml
    @JsonProperty("tenantId")
    private String tenantId;

    @SafeHtml
    @JsonProperty("serviceRequestId")
    private String serviceRequestId;

    // MDMS common-masters.Department code(s) or name(s) (e.g. "WATER_SUPPLY"), OR'd together —
    // see AdminComplaintSearchService#resolveDepartmentCodes for the code/name matching.
    @JsonProperty("departmentCode")
    private Set<String> departmentCode;

    @JsonProperty("fromDate")
    private Long fromDate;

    @JsonProperty("toDate")
    private Long toDate;

    @JsonProperty("limit")
    private Integer limit;

    @JsonProperty("offset")
    private Integer offset;

    // Sortable columns: serviceRequestId, applicationStatus, createdTime, lastModifiedTime
    // (locality/Department/Category are display-only — see docs/complaint-search-page.md §4.3).
    @JsonProperty("sortBy")
    private RequestSearchCriteria.SortBy sortBy;

    @JsonProperty("sortOrder")
    private RequestSearchCriteria.SortOrder sortOrder;
}
