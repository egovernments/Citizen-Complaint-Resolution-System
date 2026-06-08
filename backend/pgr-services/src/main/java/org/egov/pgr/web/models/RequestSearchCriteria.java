package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

import java.util.Set;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RequestSearchCriteria {

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("tenantIds")
    private Set<String> tenantIds;

    @JsonProperty("serviceCode")
    private Set<String> serviceCode;

    @JsonProperty("applicationStatus")
    private Set<String> applicationStatus;

    @JsonProperty("mobileNumber")
    private String mobileNumber;

    @JsonProperty("serviceRequestId")
    private String serviceRequestId;

    @JsonProperty("locality")
    private Set<String> locality;

    @JsonProperty("ids")
    private Set<String> ids;

    @JsonProperty("fromDate")
    private Long fromDate;

    @JsonProperty("toDate")
    private Long toDate;

    @JsonProperty("slaDeltaMaxLimit")
    private Long slaDeltaMaxLimit;

    @JsonProperty("slaDeltaMinLimit")
    private Long slaDeltaMinLimit;

    @JsonProperty("sortBy")
    private SortBy sortBy;

    @JsonProperty("sortOrder")
    private SortOrder sortOrder;

    @JsonProperty("limit")
    private Integer limit;

    @JsonProperty("offset")
    private Integer offset;

    @JsonProperty("accountId")
    private String accountId;

    @JsonIgnore
    private Set<String> userIds;

    @JsonIgnore
    private Boolean isPlainSearch;

    public enum SortOrder {
        ASC, DESC
    }

    public enum SortBy {
        locality, applicationStatus, serviceRequestId, createdTime
    }

    public boolean isEmpty() {
        return tenantId == null && serviceCode == null && mobileNumber == null
                && serviceRequestId == null && applicationStatus == null
                && ids == null && userIds == null && locality == null;
    }
}
